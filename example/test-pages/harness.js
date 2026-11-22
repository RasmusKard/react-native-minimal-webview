/// <reference types="node" />
const { execFile } = require('child_process');

/** @type {Map<string, string>} */
const queued = new Map();
const log = (/** @type {string} */ line) =>
  console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

/**
 * @typedef {{ suite: string, action: string, fail?: number }} Request
 * @typedef {{ text: string, kind: string, suite: string, block: string, name: string, detail: string }} Line
 * @typedef {{ requests: Request[], verdict: Request | null, handed: boolean, polledAt: number, fresh: boolean, device: string, log: string[], results: Line[] }} HarnessState
 */
/** @type {Map<string, HarnessState>} */
const harnessStates = new Map();
/** @param {string} platform */
function harnessState(platform) {
  let state = harnessStates.get(platform);
  if (!state) {
    state = {
      requests: [],
      verdict: null,
      handed: false,
      polledAt: 0,
      fresh: true,
      device: '',
      log: [],
      results: [],
    };
    harnessStates.set(platform, state);
  }
  return state;
}
const adbDevice = (/** @type {string} */ platform) => {
  const { device } = harnessState(platform);
  return device ? ['-s', device] : [];
};
/** @type {Set<() => void>} */
const waiters = new Set();
const harnessChanged = () => waiters.forEach((check) => check());
/**
 * Answers with what `get` returns once it is a non-empty string (checked now and on every harness change), or with ''
 * after `ms`.
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
/** @type {Map<string, string>} */
const perfResults = new Map();
const APP_ID = 'expo.modules.minimalwebview.example';

/**
 * Gives `then` the request's JSON body and ends the response; a body that isn't JSON gets a 400.
 * @template T
 * @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {(body: T) => void} then
 */
function readJson(req, res, then) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    /** @type {T} */
    let parsed;
    try {
      parsed = /** @type {T} */ (JSON.parse(body));
    } catch {
      return res.writeHead(400).end('not JSON');
    }
    then(parsed);
    res.end();
  });
}

/** Text for an XML attribute, without the control characters XML has no form for. */
const xml = (/** @type {string} */ text) =>
  text
    .replace(/[^\t\n\r\x20-\uFFFD]/g, '')
    .replace(/[<>&"\n\r\t]/g, (c) => `&#${c.charCodeAt(0)};`);
/** @param {Line[]} results */
function junit(results) {
  const suites = [...Map.groupBy(results, (line) => line.suite)].map(([suite, lines]) => {
    const count = (/** @type {string} */ kind) => lines.filter((line) => line.kind === kind).length;
    const cases = lines.map((line) => {
      const open = `<testcase classname="${xml(line.block ? `${suite}.${line.block}` : suite)}" name="${xml(line.name)}"`;
      if (line.kind === 'PASS') return `${open}/>`;
      const tag = line.kind === 'FAIL' ? 'failure' : 'skipped';
      return `${open}><${tag} message="${xml(line.detail)}"/></testcase>`;
    });
    return `<testsuite name="${xml(suite)}" tests="${lines.length}" failures="${count('FAIL')}" skipped="${count('SKIP')}">\n${cases.join('\n')}\n</testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}

/**
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
    readJson(req, res, (/** @type {Request} */ request) => {
      const state = harnessState(platform);
      if (request.action === 'done') state.verdict = request;
      else state.requests.push(request);
      harnessChanged();
    });
  },
  '/harness/step'(req, res, q, platform) {
    const [suite, after, state] = [q.get('suite'), Number(q.get('after')), harnessState(platform)];
    const get = () => {
      const step = state.requests[after] ?? state.verdict;
      return step?.suite === suite ? JSON.stringify(step) : '';
    };
    answerWhen(res, get, Number(q.get('ms') ?? 5000));
  },
  '/harness/idle'(req, res, q, platform) {
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
    Object.assign(harnessState(platform), { fresh: true, device, log: [], results: [] });
    res.end('ok');
  },
  '/driver/kill'(req, res, q, platform) {
    // iOS: the WebContent processes whose parent is the simulator's launchd_sim, whose command line names
    // `Devices/<udid>` (WebContent's own doesn't).
    const { device } = harnessState(platform);
    const launchd = `pgrep -d, -f 'launchd_sim .*/Devices/${device}'`;
    const [cmd, args] =
      platform === 'android'
        ? ['adb', [...adbDevice(platform), 'shell', 'pkill -9 -f sandboxed_process']]
        : ['sh', ['-c', `pkill -9 -P "$(${launchd})" -f com.apple.WebKit.WebContent`]];
    execFile(cmd, args, (error) => res.end(error ? `failed: ${error.message}` : 'killed'));
  },
  '/perf/result'(req, res, q, platform) {
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
    if (req.method !== 'POST')
      return res.end(
        harnessState(platform)
          .log.map((line) => `${line}\n`)
          .join('')
      );
    readJson(req, res, (/** @type {Line} */ line) => {
      const state = harnessState(platform);
      log(line.text);
      state.log.push(line.text);
      if (['PASS', 'FAIL', 'SKIP'].includes(line.kind)) state.results.push(line);
    });
  },
  '/harness/junit'(req, res, q, platform) {
    res.end(junit(harnessState(platform).results));
  },
};

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {URL} url */
function handleHarness(req, res, url) {
  const route = ROUTES[url.pathname];
  if (route) route(req, res, url.searchParams, url.searchParams.get('platform') ?? '');
  else res.writeHead(404).end('not found');
}

module.exports = { handleHarness };
