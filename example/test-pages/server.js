/// <reference types="node" />
// Serves the test pages on http://localhost:8090 (iOS simulator) and, after `adb reverse tcp:8090 tcp:8090`, on the
// Android emulator. http://127.0.0.1:8090 is a second origin for cross-origin and bridge origin-rejection tests.
//   /redirect?to=<path>&code=302  server redirect
//   /download?name=<file>          attachment response
//   /moved?key=<k>                 an attachment the first time for a key, then a redirect to /download on 127.0.0.1
//                                  (an Android download is fetched again, and must follow it)
//   /post                          echoes a form POST (payment-style flow)
//   /slow?ms=<n>                   delays the response
//   /status/<code>                 empty response with that status
//   /ua                            shows the User-Agent header the server received
//   /flaky?key=<k>                 503 the first time for a key, then the normal page (reload-after-error tests)
//   /harness/run?platform=<ios|android>&suite=<name>  queues a harness suite; the example app polls /harness/next and posts results to
//                                  /harness/log, which this server prints
//   /harness/await, /harness/verdict, /harness/idle, /harness/fresh  what the driver (Maestro) waits on: see harnessState
// https://localhost:8443 serves the same pages with a self-signed certificate: an SSL error on both platforms.
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Buffer } = require('buffer');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT ?? 8090);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 8443);
const ROOT = __dirname;
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
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
  fs.createReadStream(file).pipe(res);
}

/** @type {Map<string, string>} platform (ios | android) -> suite name */
const queued = new Map();
/** A log line with the time, so a run shows where its time goes. */
const log = (/** @type {string} */ line) =>
  console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

/**
 * What the harness is doing on a platform, so the driver can wait on it here instead of reading the screen (a UI
 * hierarchy query costs Maestro seconds): the suite it took, the driver requests it made in that suite
 * (`<suite>#<n> <REQUEST> <detail>`), its verdict (`<suite>#done pass=… fail=…`), and when the app last polled.
 * `fresh` makes the next idle check say no, so a run starts with a fresh launch.
 * `failures` are the run's failed checks, for run.sh to print.
 * @typedef {{ requests: string[], verdict: string, handed: boolean, polledAt: number, fresh: boolean, failures: string[] }} HarnessState
 */
/** @type {Map<string, HarnessState>} */
const harnessStates = new Map();
/** @param {string} platform */
function harnessState(platform) {
  let state = harnessStates.get(platform);
  if (!state) {
    state = { requests: [], verdict: '', handed: false, polledAt: 0, fresh: true, failures: [] };
    harnessStates.set(platform, state);
  }
  return state;
}
/** @type {Set<() => void>} */
const waiters = new Set();
const harnessChanged = () => waiters.forEach((check) => check());
/**
 * Answers with what `get` returns once it is a non-empty string (checked now and on every harness change), or with ''
 * after `ms`. Long-polls stay short (Maestro's HTTP client times out), so the driver asks again.
 * @param {import('http').ServerResponse} res @param {() => string} get @param {number} ms
 */
function answerWhen(res, get, ms) {
  const check = () => {
    const value = get();
    if (!value) return;
    finish(value);
  };
  /** @param {string} value */
  const finish = (value) => {
    waiters.delete(check);
    clearTimeout(timer);
    res.end(value);
  };
  const timer = setTimeout(() => finish(''), Math.min(ms, 8000));
  waiters.add(check);
  check();
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
    console.warn("no openssl: the https port (the errors suite's SSL check) is off");
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
  const platform = q.get('platform') ?? '';
  if (url.pathname === '/harness/run') {
    queued.set(platform, q.get('suite') ?? '');
    Object.assign(harnessState(platform), { requests: [], verdict: '', handed: false });
    log(`[server] queued ${platform} ${q.get('suite')}`);
    res.end('queued');
  } else if (url.pathname === '/harness/request') {
    // The harness's driver requests and verdicts, as it shows them on screen.
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const state = harnessState(platform);
      if (/^\w+#done /.test(body)) state.verdict = body;
      else state.requests.push(body);
      harnessChanged();
      res.end();
    });
  } else if (url.pathname === '/harness/await') {
    // Request `n` of the suite, or its verdict when it ended first.
    const [suite, n, state] = [q.get('suite') ?? '', Number(q.get('n')), harnessState(platform)];
    const get = () =>
      (state.requests[n - 1]?.startsWith(`${suite}#${n} `) && state.requests[n - 1]) ||
      (state.verdict.startsWith(`${suite}#`) && state.verdict) ||
      '';
    answerWhen(res, get, Number(q.get('ms') ?? 5000));
  } else if (url.pathname === '/harness/verdict') {
    const [suite, state] = [q.get('suite') ?? '', harnessState(platform)];
    answerWhen(
      res,
      () => (state.verdict.startsWith(`${suite}#done `) ? state.verdict : ''),
      Number(q.get('ms') ?? 5000)
    );
  } else if (url.pathname === '/harness/idle') {
    // `yes` when the app can take the next suite as it is: it polls (after its reset), and its last suite passed. Else
    // the driver launches it fresh: the first suite of a run, after a failure, a crash or a suite cut off midway.
    const state = harnessState(platform);
    const passed = !state.handed || / fail=0$/.test(state.verdict);
    if (state.fresh || !passed) {
      state.fresh = false;
      res.end('no');
      return;
    }
    const asked = Date.now();
    answerWhen(res, () => (state.polledAt > asked ? 'yes' : ''), Number(q.get('ms') ?? 5000));
  } else if (url.pathname === '/harness/fresh') {
    Object.assign(harnessState(platform), { fresh: true, failures: [] });
    res.end('ok');
  } else if (url.pathname === '/harness/failures') {
    res.end(
      harnessState(platform)
        .failures.map((line) => `${line}\n`)
        .join('')
    );
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
    const suite = queued.get(platform) ?? '';
    const state = harnessState(platform);
    state.polledAt = Date.now();
    if (suite) {
      Object.assign(state, { requests: [], verdict: '', handed: true });
      log(`[server] handed ${platform} ${suite}`);
    }
    harnessChanged();
    res.end(suite);
    queued.delete(platform);
  } else if (url.pathname === '/harness/log') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      log(body);
      if (/^\[harness \S+ [^\]]*\] FAIL /.test(body)) harnessState(platform).failures.push(body);
      res.end();
    });
  } else if (url.pathname === '/headers') {
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
  } else if (url.pathname === '/auth2') {
    // Offers Digest and Basic: declining one must not ask again for the other.
    res.writeHead(401, {
      'www-authenticate': ['Digest realm="two", nonce="n", qop="auth"', 'Basic realm="two"'],
      'content-type': 'text/html',
    });
    res.end('<!doctype html><h1 id="auth">unauthorized</h1>');
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
