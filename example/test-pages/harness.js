/// <reference types="node" />
// The harness's side of the test pages server (server.js). The app polls /harness/next for the suite /harness/run
// queued and posts its results to /harness/log, which this prints. The driver (Maestro) waits on /harness/step and
// /harness/idle instead of reading the screen (see harnessState), and reaches the device through /driver.
const { execFile } = require('child_process');

/** @type {Map<string, string>} platform (ios | android) -> suite name */
const queued = new Map();
/** A log line with the time, so a run shows where its time goes. */
const log = (/** @type {string} */ line) =>
  console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

/**
 * What the harness is doing on a platform, so the driver can wait on it here instead of reading the screen (a UI
 * hierarchy query costs Maestro seconds): the suite it took, the driver requests it made in that suite
 * and its verdict (`DriverAction` in harness/runner.ts, with the suite's name), and when the app last polled.
 * `fresh` makes the next idle check say no, so a run starts with a fresh launch, and `device` is the run's device id
 * (an adb serial or a simulator's UDID), for /driver.
 * `log` is what the app logged in the run, for run.sh.
 * @typedef {{ suite: string, action: string, fail?: number }} Request
 * @typedef {{ requests: Request[], verdict: Request | null, handed: boolean, polledAt: number, fresh: boolean, device: string, log: string[] }} HarnessState
 */
/** @type {Map<string, HarnessState>} */
const harnessStates = new Map();
/** @param {string} platform */
function harnessState(platform) {
  let state = harnessStates.get(platform);
  if (!state) {
    state = { requests: [], verdict: null, handed: false, polledAt: 0, fresh: true, device: '', log: [] };
    harnessStates.set(platform, state);
  }
  return state;
}
/** adb's arguments for the run's device; none when the run named none (adb then needs a single device). */
const adbDevice = (/** @type {string} */ platform) => {
  const { device } = harnessState(platform);
  return device ? ['-s', device] : [];
};
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
/** @type {Map<string, string>} the perf suite's page samples, by run */
const perfResults = new Map();
const APP_ID = 'expo.modules.minimalwebview.example';

/**
 * The /harness, /driver and /perf requests, by path: the request, the response, the URL's parameters and its `platform`.
 * @type {Record<string, (req: import('http').IncomingMessage, res: import('http').ServerResponse, q: URLSearchParams, platform: string) => void>}
 */
const ROUTES = {
  '/harness/run'(req, res, q, platform) {
    queued.set(platform, q.get('suite') ?? '');
    Object.assign(harnessState(platform), { requests: [], verdict: null, handed: false });
    log(`[server] queued ${platform} ${q.get('suite')}`);
    res.end('queued');
  },
  '/harness/request'(req, res, q, platform) {
    // The harness's driver requests and verdicts, as it shows them on screen.
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const state = harnessState(platform);
      /** @type {Request} */
      let request;
      try {
        request = /** @type {Request} */ (JSON.parse(body));
      } catch {
        return res.writeHead(400).end('not JSON');
      }
      if (request.action === 'done') state.verdict = request;
      else state.requests.push(request);
      harnessChanged();
      res.end();
    });
  },
  '/harness/step'(req, res, q, platform) {
    // The suite's driver request after its first `after`, or its verdict once it has no more.
    const [suite, after, state] = [q.get('suite'), Number(q.get('after')), harnessState(platform)];
    const get = () => {
      const step = state.requests[after] ?? state.verdict;
      return step?.suite === suite ? JSON.stringify(step) : '';
    };
    answerWhen(res, get, Number(q.get('ms') ?? 5000));
  },
  '/harness/idle'(req, res, q, platform) {
    // `yes` when the app can take the next suite as it is: it polls (after its reset), and its last suite passed. Else
    // the driver launches it fresh: the first suite of a run, after a failure, a crash or a suite cut off midway.
    const state = harnessState(platform);
    const passed = !state.handed || state.verdict?.fail === 0;
    if (state.fresh || !passed) {
      state.fresh = false;
      res.end('no');
      return;
    }
    const asked = Date.now();
    answerWhen(res, () => (state.polledAt > asked ? 'yes' : ''), Number(q.get('ms') ?? 5000));
  },
  '/harness/fresh'(req, res, q, platform) {
    const device = q.get('device') ?? '';
    if (!/^[\w.:-]*$/.test(device)) return res.writeHead(400).end('bad device');
    Object.assign(harnessState(platform), { fresh: true, device, log: [] });
    res.end('ok');
  },
  '/driver/kill'(req, res, q, platform) {
    // For the crash suite's UI-test driver (Maestro has no shell): kill the page's renderer process.
    // (chrome://crash crashes a fresh renderer that never hosts the page, so WebView doesn't report it.)
    // Android needs `adb root`. iOS: the WebContent processes whose parent is the simulator's launchd_sim, whose
    // command line names `Devices/<udid>` (WebContent's own doesn't).
    const { device } = harnessState(platform);
    const launchd = `pgrep -d, -f 'launchd_sim .*/Devices/${device}'`;
    const [cmd, args] =
      platform === 'android'
        ? ['adb', [...adbDevice(platform), 'shell', 'pkill -9 -f sandboxed_process']]
        : ['sh', ['-c', `pkill -9 -P "$(${launchd})" -f com.apple.WebKit.WebContent`]];
    execFile(cmd, args, (error) => res.end(error ? `failed: ${error.message}` : 'killed'));
  },
  '/perf/result'(req, res, q, platform) {
    // The perf suite's page-side samples: perf.html posts them, the harness reads them back (empty until posted).
    const run = q.get('run') ?? '';
    if (req.method !== 'POST') return res.end(perfResults.get(run) ?? '');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      perfResults.set(run, body);
      log(`[perf] ${run} ${body.length > 200 ? `${body.length} bytes` : body}`);
      res.end();
    });
  },
  '/driver/memory'(req, res, q, platform) {
    // The perf suite's memory read, in KB: TOTAL PSS of the app and the WebView renderers it bound (Android, `dumpsys
    // meminfo`), or the footprint of the app and the WebKit processes its simulator's launchd_sim runs (iOS: no other
    // app there uses WebKit). Lists the processes it summed.
    const [cmd, args] =
      platform === 'android'
        ? [
            'adb',
            [
              ...adbDevice(platform),
              'shell',
              `for p in $(pidof ${APP_ID}) $(dumpsys activity services ${APP_ID} | sed -n 's/.*app=ProcessRecord{[0-9a-f]* \\([0-9]*\\):.*sandboxed.*/\\1/p' | sort -u); do echo "P $p $(tr '\\0' ' ' < /proc/$p/cmdline | cut -c1-90)"; dumpsys meminfo $p | grep -E 'TOTAL PSS:|WebViews:'; done`,
            ],
          ]
        : [
            'sh',
            [
              '-c',
              `A=$(pgrep -f '/reactnativeminimalwebviewexample.app/reactnativeminimalwebviewexampl[e]' | head -1); footprint --noCategories -f bytes -p $A $(pgrep -P "$(ps -o ppid= -p $A)" -f com.apple.WebKit | sed 's/^/-p /')`,
            ],
          ];
    execFile(cmd, args, (error, stdout) => {
      if (error) return res.writeHead(500).end(error.message);
      /** @type {{ pid: number, name: string, kb: number, webViews?: string }[]} */
      const processes = [];
      if (platform === 'android') {
        for (const [, pid, name, kb, webViews] of stdout.matchAll(
          /^P (\d+) (.*)\n.*TOTAL PSS:\s+(\d+)(?:.*\n.*WebViews:\s+(\d+))?/gm
        ))
          processes.push({ pid: Number(pid), name: name.trim(), kb: Number(kb), webViews });
      } else {
        for (const [, name, pid, bytes] of stdout.matchAll(
          /^(\S.*) \[(\d+)\]: \S+\s+Footprint: (\d+) B/gm
        ))
          processes.push({ pid: Number(pid), name, kb: Math.round(Number(bytes) / 1024) });
      }
      const totalKb = processes.reduce((sum, p) => sum + p.kb, 0);
      res.end(JSON.stringify({ totalKb, processes }));
    });
  },
  '/harness/next'(req, res, q, platform) {
    const suite = queued.get(platform) ?? '';
    const state = harnessState(platform);
    state.polledAt = Date.now();
    if (suite) {
      Object.assign(state, { requests: [], verdict: null, handed: true });
      log(`[server] handed ${platform} ${suite}`);
    }
    harnessChanged();
    res.end(suite);
    queued.delete(platform);
  },
  '/harness/log'(req, res, q, platform) {
    // The app posts a line; run.sh gets the run's lines.
    if (req.method !== 'POST')
      return res.end(
        harnessState(platform)
          .log.map((line) => `${line}\n`)
          .join('')
      );
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      log(body);
      harnessState(platform).log.push(body);
      res.end();
    });
  },
};

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {URL} url */
function handleHarness(req, res, url) {
  const route = ROUTES[url.pathname];
  if (route) route(req, res, url.searchParams, url.searchParams.get('platform') ?? '');
  else res.writeHead(404).end('not found');
}

module.exports = { handleHarness };
