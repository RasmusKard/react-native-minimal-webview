/// <reference types="node" />
// Serves the test pages on http://localhost:8090 (iOS simulator) and, after `adb reverse` of ports 8090 and 8443, on
// the Android emulator (other ports: ../pages.ts). http://127.0.0.1:8090 is a second origin for cross-origin and bridge
// origin-rejection tests, and https://localhost:8443 serves the same pages with a self-signed certificate: an SSL error
// on both platforms. The harness runs through it too (harness.js).
const { Buffer } = require('buffer');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const { handleHarness } = require('./harness');

const PORT = Number(process.env.EXPO_PUBLIC_PAGES_PORT ?? 8090);
const HTTPS_PORT = Number(process.env.EXPO_PUBLIC_PAGES_HTTPS_PORT ?? 8443);
const ROOT = __dirname;
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

/** @param {import('http').ServerResponse} res @param {string} pathname */
function serveFile(res, pathname) {
  let file = path.join(ROOT, path.normalize(pathname === '/' ? '/index.html' : pathname));
  // SPA-style fallback: extensionless paths (/spa/pushed, /checkout/pay) reload as spa.html
  if (!fs.existsSync(file) && !path.extname(file)) file = path.join(ROOT, 'spa.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  if (path.extname(file) !== '.html') return void fs.createReadStream(file).pipe(res);
  // The pages name the default ports.
  const html = fs.readFileSync(file, 'utf8');
  res.end(html.replace(/(:|%3A)8090\b/g, `$1${PORT}`).replace(/:8443\b/g, `:${HTTPS_PORT}`));
}


// A self-signed certificate for the https port, made at start (openssl ships with macOS).
/** @returns {{ key: Buffer, cert: Buffer } | null} */
function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pages-'));
  const [key, cert] = [path.join(dir, 'key.pem'), path.join(dir, 'cert.pem')];
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' }
    );
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch {
    console.warn('no openssl: the https port (the SSL checks) is off');
    return null;
  }
}
/** Auth keys (the `t` of an /auth URL) that got their first challenge. */
const challenged = new Set();
const dropping = new Set();
const flakyKeys = new Set();
const movedKeys = new Set();

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams;
  if (/^\/(harness|driver|perf)\//.test(url.pathname)) return handleHarness(req, res, url);
  if (url.pathname === '/headers') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><pre id="headers">${JSON.stringify(req.headers).replace(/</g, '&lt;')}</pre>`
    );
  } else if (url.pathname === '/auth') {
    // Basic auth: user "u", password "p". Each URL's `t` is a realm of its own that is challenged first: a WebView that
    // signed in on another test page (an earlier suite, same process) would otherwise send those credentials unasked.
    const key = q.get('t') ?? '';
    const first = !challenged.has(key);
    challenged.add(key);
    if (!first && req.headers.authorization === `Basic ${Buffer.from('u:p').toString('base64')}`) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><h1 id="auth">authorized</h1>');
    } else {
      res.writeHead(401, {
        'www-authenticate': `Basic realm="test realm ${key}"`,
        'content-type': 'text/html',
      });
      res.end('<!doctype html><h1 id="auth">unauthorized</h1>');
    }
  } else if (url.pathname === '/setcookie') {
    res.writeHead(200, {
      'set-cookie': `${q.get('name') ?? 'native'}=${q.get('value') ?? '1'}; Path=/`,
    });
    res.end('set');
  } else if (url.pathname === '/cookies') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><pre id="cookies">${(req.headers.cookie ?? '').replace(/</g, '&lt;')}</pre>`
    );
  } else if (url.pathname === '/ua') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><pre id="ua">${(req.headers['user-agent'] ?? '').replace(/</g, '&lt;')}</pre>`
    );
  } else if (url.pathname === '/drop') {
    // The pull-to-refresh page, or a dropped connection while /drop/set turned failing on (a failed reload; browsers
    // retry a dropped keep-alive request once, so a one-shot failure would not reach the page).
    if (dropping.has(q.get('key') ?? '')) return req.socket.destroy();
    return serveFile(res, '/ptr.html');
  } else if (url.pathname === '/drop/set') {
    if (q.get('fail') === '1') dropping.add(q.get('key') ?? '');
    else dropping.delete(q.get('key') ?? '');
    res.end('ok');
  } else if (url.pathname === '/flaky') {
    const key = q.get('key') ?? '';
    if (flakyKeys.has(key)) return serveFile(res, '/index.html');
    flakyKeys.add(key);
    res.writeHead(503).end('try again');
  } else if (url.pathname === '/checkout/loopA' || url.pathname === '/checkout/loopB') {
    // A redirect loop between two URLs (for the `ask` loop guard).
    res
      .writeHead(302, {
        location: url.pathname.endsWith('A') ? '/checkout/loopB' : '/checkout/loopA',
      })
      .end();
  } else if (url.pathname === '/redirect') {
    res.writeHead(Number(q.get('code') ?? 302), { location: q.get('to') ?? '/' }).end();
  } else if (url.pathname === '/moved' && movedKeys.has(q.get('key') ?? '')) {
    // Android fetches a download again, and must follow this redirect to another host.
    res.writeHead(302, { location: `http://127.0.0.1:${PORT}/download?name=moved.txt` }).end();
  } else if (url.pathname === '/moved') {
    movedKeys.add(q.get('key') ?? '');
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="moved.txt"',
    });
    res.end('first response\n');
  } else if (url.pathname === '/download') {
    const name = q.get('name') ?? 'report.txt';
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename="${name}"`,
    });
    res.end(
      `downloaded ${name} at ${new Date().toISOString()}\ncookie: ${req.headers.cookie ?? ''}\n`
    );
  } else if (url.pathname === '/post') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta name="viewport" content="width=device-width"><h1>POST received</h1><pre id="body">${body.replace(/</g, '&lt;')}</pre><a href="/">home</a>`
      );
    });
  } else if (url.pathname === '/slow') {
    setTimeout(() => serveFile(res, '/index.html'), Number(q.get('ms') ?? 3000));
  } else if (url.pathname.startsWith('/status/')) {
    res.writeHead(Number(url.pathname.split('/')[2])).end();
  } else {
    serveFile(res, url.pathname);
  }
}

// Loopback only, on both stacks: the simulator may resolve localhost to ::1.
const tls = selfSigned();
for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handle).listen(PORT, host);
  if (tls) https.createServer(tls, handle).listen(HTTPS_PORT, host);
}
console.log(
  `test pages on http://localhost:${PORT}${tls ? ` and https://localhost:${HTTPS_PORT}` : ''}`
);
