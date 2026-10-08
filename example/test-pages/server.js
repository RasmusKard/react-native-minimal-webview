// Serves the test pages on http://localhost:8090 (iOS simulator) and, after `adb reverse tcp:8090 tcp:8090`, on the
// Android emulator. http://127.0.0.1:8090 is a second origin for cross-origin and bridge origin-rejection tests.
//   /redirect?to=<path>&code=302  server redirect
//   /download?name=<file>          attachment response
//   /post                          echoes a form POST (payment-style flow)
//   /slow?ms=<n>                   delays the response
//   /status/<code>                 empty response with that status
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

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams;
  if (url.pathname === '/redirect') {
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
