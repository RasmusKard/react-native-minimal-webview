// Serves the test pages on http://localhost:8090 (iOS simulator) and, after `adb reverse tcp:8090 tcp:8090`, on the
// Android emulator. http://127.0.0.1:8090 is a second origin for cross-origin and bridge origin-rejection tests.
//   /redirect?to=<path>&code=302  server redirect
//   /download?name=<file>          attachment response
//   /post                          echoes a form POST (payment-style flow)
//   /slow?ms=<n>                   delays the response
//   /status/<code>                 empty response with that status
//   /ua                            shows the User-Agent header the server received
//   /flaky?key=<k>                 503 the first time for a key, then the normal page (reload-after-error tests)
//   /harness/run?platform=<ios|android>&suite=<name>  queues a harness suite; the example app polls /harness/next and posts results to
//                                  /harness/log, which this server prints
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT ?? 8090);
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
};

function serveFile(res, pathname) {
  let file = path.join(ROOT, path.normalize(pathname === '/' ? '/index.html' : pathname));
  // SPA-style fallback: extensionless paths (/spa/pushed, /checkout/pay) reload as spa.html
  if (!fs.existsSync(file) && !path.extname(file)) file = path.join(ROOT, 'spa.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const queued = new Map(); // platform (ios | android) -> suite name
const dropping = new Set();
const flakyKeys = new Set();

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams;
  if (url.pathname === '/harness/run') {
    queued.set(q.get('platform') ?? '', q.get('suite') ?? '');
    res.end('queued');
  } else if (url.pathname === '/driver/kill') {
    // For the crash suite's UI-test driver (Maestro has no shell): kill the page's renderer process.
    // Android needs `adb root`; on iOS this kills every simulator's WebContent process.
    const device = q.get('device') ?? '';
    if (!/^[\w.:-]*$/.test(device)) return res.writeHead(400).end('bad device');
    const [cmd, args] =
      q.get('platform') === 'android'
        ? ['adb', [...(device ? ['-s', device] : []), 'shell', 'pkill -9 -f sandboxed_process']]
        : ['pkill', ['-9', '-f', 'CoreSimulator.*com.apple.WebKit.WebContent']];
    execFile(cmd, args, (error) => res.end(error ? `failed: ${error.message}` : 'killed'));
  } else if (url.pathname === '/harness/next') {
    res.end(queued.get(q.get('platform') ?? '') ?? '');
    queued.delete(q.get('platform') ?? '');
  } else if (url.pathname === '/harness/log') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      console.log(body);
      res.end();
    });
  } else if (url.pathname === '/headers') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><pre id="headers">${JSON.stringify(req.headers).replace(/</g, '&lt;')}</pre>`);
  } else if (url.pathname === '/auth') {
    // Basic auth: user "u", password "p".
    if (req.headers.authorization === `Basic ${Buffer.from('u:p').toString('base64')}`) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><h1 id="auth">authorized</h1>');
    } else {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="test realm"', 'content-type': 'text/html' });
      res.end('<!doctype html><h1 id="auth">unauthorized</h1>');
    }
  } else if (url.pathname === '/auth2') {
    // Offers Digest and Basic: declining one must not ask again for the other.
    res.writeHead(401, {
      'www-authenticate': ['Digest realm="two", nonce="n", qop="auth"', 'Basic realm="two"'],
      'content-type': 'text/html',
    });
    res.end('<!doctype html><h1 id="auth">unauthorized</h1>');
  } else if (url.pathname === '/setcookie') {
    res.writeHead(200, { 'set-cookie': `${q.get('name') ?? 'native'}=${q.get('value') ?? '1'}; Path=/` });
    res.end('set');
  } else if (url.pathname === '/cookies') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><pre id="cookies">${(req.headers.cookie ?? '').replace(/</g, '&lt;')}</pre>`);
  } else if (url.pathname === '/ua') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width"><pre id="ua">${(req.headers['user-agent'] ?? '').replace(/</g, '&lt;')}</pre>`);
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
    res.writeHead(302, { location: url.pathname.endsWith('A') ? '/checkout/loopB' : '/checkout/loopA' }).end();
  } else if (url.pathname === '/redirect') {
    res.writeHead(Number(q.get('code') ?? 302), { location: q.get('to') ?? '/' }).end();
  } else if (url.pathname === '/download') {
    const name = q.get('name') ?? 'report.txt';
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename="${name}"`,
    });
    res.end(`downloaded ${name} at ${new Date().toISOString()}\n`);
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
for (const host of ['127.0.0.1', '::1']) http.createServer(handle).listen(PORT, host);
console.log(`test pages on http://localhost:${PORT}`);
