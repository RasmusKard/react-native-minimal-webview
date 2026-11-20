// The on-device suites (SUITES, at the end). Each result is logged as `[harness <platform>] PASS|FAIL|INFO ...` to the
// JS console and to the test pages server, which prints it.
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { AppState, Platform } from 'react-native';
import type {
  Bridge,
  Download,
  DownloadFailure,
  FileRequest,
  NavigationEvent,
  NavigationRule,
  ProcessGoneEvent,
  PermissionRequest,
  LoadErrorEvent,
  NavigationState,
  WebViewProps,
  WebViewRefObject,
  WebViewSource,
} from 'react-native-minimal-webview';
import { AndroidWebView, IOSConstants } from 'react-native-minimal-webview';
import { pageCounter, sampleHook, seams } from 'sample-extension';

import { extensions } from './extensions';
import { hostile } from './hostile';
import { perf, perfCold } from './perf';
import { shapes } from './shapes';

/**
 * Extra WebView props for a suite. Its `extensions` come after App's own, the page counter, which `withoutPageCounter`
 * leaves out.
 */
export type HarnessProps = Partial<WebViewProps> & { withoutPageCounter?: boolean };

export type Harness = {
  pages: string;
  platform: string;
  ref: WebViewRefObject;
  /** Where the WebView sits in the window and its height, in dp, for a driver's TAP; kept current by App's onLayout. */
  webViewOffset: { x: number; y: number; height: number };
  state: () => NavigationState;
  /** Remounts the WebView (a new `key`) without re-rendering App. */
  remount: () => void;
  load: (uri: string) => void;
  loadSource: (source: WebViewSource) => void;
  setRules: (rules: NavigationRule[] | undefined) => void;
  setAsk: (ask: WebViewProps['onNavigationRequest']) => void;
  bridge: Bridge;
  /** Payloads of `pageEvent` events the page emitted. */
  pageEvents: unknown[];
  setFileRequest: (handler: WebViewProps['onFileRequest']) => void;
  setPermission: (handler: WebViewProps['onPermissionRequest']) => void;
  /** Extra WebView props, replacing the previous extras. An `ios` keeps the example's `configuration` unless it has one. */
  setProps: (props: HarnessProps) => void;
  /** Renders `n` plain WebViews (no bridge) below the measured one: the perf suite's memory read. */
  setExtraWebViews: (n: number) => void;
  /** Shows a full-screen modal over the app, or hides it. */
  setCovered: (covered: boolean) => void;
  /** What the WebView reported, in order. Suites clear what they read. */
  events: {
    errors: LoadErrorEvent[];
    gone: ProcessGoneEvent[];
    /** `start` and `end`, from onLoadStart and onLoadEnd. */
    loads: string[];
    /** Each onLoadEnd's `outcome`. */
    outcomes: NavigationState['outcome'][];
    navigations: NavigationEvent[];
    downloads: Download[];
    downloadFailures: DownloadFailure[];
    fullscreen: boolean[];
    pageCounts: { url: string; count: number }[];
    /** The page counter's `documentEnd` payloads: the reason, and `context.url` at that moment. */
    documentEnds: { reason: string; url: string }[];
    /** The names of the hooks' other events. */
    hookEvents: string[];
    /** Whether the example's error screen is mounted. */
    overlay: { error: boolean };
  };
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `performance.now()` at App's first render and at its first onLoadEnd: the perfCold suite's cold mount. */
export const launchMarks: { render?: number; loadEnd?: number } = {};

let current: Harness | null = null;

function emit(line: string) {
  const text = `[harness ${current?.platform}] ${line}`;
  console.log(text);
  // A failed post surfaces as an unhandled rejection; the console line above still has the result.
  void fetch(`${current?.pages}/harness/log?platform=${Platform.OS}`, {
    method: 'POST',
    body: text,
  });
}

let showRequest: (text: string) => void = () => {};
/**
 * What the harness wants from an outside driver, shown on screen (testID `harness-request`) so a UI test tool can wait
 * for it: `<suite>#<n> <REQUEST> <detail>` for each request (upper-case `info` names), `<suite>#done pass=… fail=…` last.
 */
export const onDriverRequest = (listener: (text: string) => void) => (showRequest = listener);

/** A driver request or a verdict: on screen, and posted to the test server, where the driver waits for it. */
function request(text: string) {
  showRequest(text);
  // As in emit: a failed post surfaces as an unhandled rejection, and the driver's wait for it times out.
  void fetch(`${current?.pages}/harness/request?platform=${Platform.OS}`, {
    method: 'POST',
    body: text,
  });
}

/** The first Android System WebView with what a check needs, for `reporter`. */
export const WEBVIEW = {
  /** WEB_MESSAGE_LISTENER */
  evaluate: 83,
  /** WEB_MESSAGE_LISTENER and DOCUMENT_START_SCRIPT, as androidx.webkit matches them */
  bridge: 101,
  /** DOCUMENT_START_SCRIPT, as androidx.webkit matches it */
  injectedScripts: 101,
  /** The file input's `cancel` event, which upload.html waits for. */
  fileInputCancel: 113,
  /** PAYMENT_REQUEST */
  paymentRequest: 136,
  /** NAVIGATION_LISTENER */
  navigationListener: 146,
};

let webViewMajor: number | undefined;
/** The Android System WebView's major version, from its default user agent (no page needed); 0 on iOS. */
const androidWebView = () =>
  (webViewMajor ??= Number(/Chrome\/(\d+)/.exec(AndroidWebView.defaultUserAgent ?? '')?.[1] ?? 0));

/** A suite's checks and INFO lines. With a `floor` (a `WEBVIEW` value) each `check` is a `since(floor, …)`. */
export function reporter(suite: string, floor = 0) {
  let pass = 0;
  let fail = 0;
  let requests = 0;
  const info = (name: string, detail: unknown) => {
    if (/^[A-Z]+$/.test(name)) request(`${suite}#${++requests} ${name} ${JSON.stringify(detail)}`);
    emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
  };
  /**
   * A check, or on an Android System WebView older than `version` (a `WEBVIEW` value) the INFO line
   * `known limit (WebView <version>): <name>`: that WebView lacks what the check needs.
   */
  const since = (version: number, name: string, ok: boolean, detail: unknown = '') => {
    const major = androidWebView();
    if (major > 0 && major < version) {
      info(`known limit (WebView <${version}): ${name}`, { major, ok, detail });
      return;
    }
    if (ok) pass++;
    else fail++;
    emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
  };
  return {
    check: (name: string, ok: boolean, detail: unknown = '') => since(floor, name, ok, detail),
    info,
    since,
    done() {
      request(`${suite}#done pass=${pass} fail=${fail}`);
      emit(`DONE ${suite} pass=${pass} fail=${fail}`);
    },
  };
}

/** Runs suites queued with `curl 'localhost:8090/harness/run?platform=ios&suite=<name>'`. */
export function pollForSuites(get: () => Harness) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const name = await fetch(`${get().pages}/harness/next?platform=${Platform.OS}`).then(
      (r) => r.text(),
      (error: unknown) => {
        console.warn('[harness] poll failed', error);
        return '';
      }
    );
    if (!name) return;
    busy = true;
    current = get();
    const suite = SUITES[name] ?? ON_DEMAND[name];
    try {
      if (!suite) throw new Error('unknown suite');
      await suite(current);
    } catch (error) {
      // A suite that throws still gets a verdict, so the driver doesn't wait for one until it times out.
      request(`${name}#done pass=? fail=1`);
      emit(`FAIL ${name}: threw ${String(error)}`);
      emit(`DONE ${name} pass=? fail=1`);
    } finally {
      await reset(current).catch((error: unknown) =>
        emit(`FAIL reset after ${name}: ${String(error)}`)
      );
      busy = false;
    }
  }, 50);
  return () => clearInterval(timer);
}

/**
 * Puts back what suites change, so the next suite starts clean even after one threw: the handlers, rules and extra
 * props, the event logs, and a new WebView (an Android settings key with no getter is not reset by its absence).
 */
async function reset(h: Harness) {
  h.setProps({});
  h.setExtraWebViews(0);
  h.setCovered(false);
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setPermission(undefined);
  h.setFileRequest(undefined);
  await waitForLoad(
    h,
    () => h.remount(),
    (s) => s.url !== '' && idle(s),
    10000
  );
  clearEvents(h);
}

/** Polls `fn` until it returns something truthy, and returns that; undefined after `ms`. */
export async function until<T>(
  fn: () => T | Promise<T>,
  ms = 10000,
  step = 100
): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(step)) {
    const value = await fn();
    if (value) return value;
  }
  return undefined;
}

/** Collects each `console.warn` line (the WebView's warnings among them) until `stop` restores `console.warn`. */
export function captureWarnings() {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    warn(...args);
  };
  return {
    lines,
    warned: (text: string) => lines.some((line) => line.includes(text)),
    stop: () => {
      console.warn = warn;
    },
  };
}

export const waitFor = async (
  h: Pick<Harness, 'state'>,
  predicate: (s: NavigationState) => boolean,
  ms = 10000
) => (await until(() => predicate(h.state()), ms, 50)) === true;

export const idle = (s: NavigationState) => !s.loading && s.pendingUrl === null;

/** The native key the `userAgent` prop sets. */
const USER_AGENT_KEY =
  Platform.OS === 'ios' ? 'webView.customUserAgent' : 'settings.userAgentString';

/**
 * Runs `act`, then waits for a load that ends after it (onLoadEnd) and for `done`, by default the idle page: whether
 * both came within `ms`. Until the new load reports, the state can still be the old page's (or the old WebView's), so
 * `done` alone could match too early.
 */
export async function waitForLoad(
  h: Harness,
  act: () => unknown,
  done: (s: NavigationState) => boolean = idle,
  ms = 15000
) {
  const loads = h.events.loads.length;
  await act();
  return await waitFor(h, (s) => h.events.loads.slice(loads).includes('end') && done(s), ms);
}

/**
 * For a request handler that never settles: `never(signal)` is its pending answer, and `stuck` says when its signal
 * aborted (`abortedAt`, 0 until then) and answers it (`release`).
 */
function stuckHandler<T>() {
  const stuck = { abortedAt: 0, release: (_value: T) => {} };
  const never = (signal: AbortSignal) => {
    signal.addEventListener('abort', () => (stuck.abortedAt = Date.now()));
    return new Promise<T>((resolve) => (stuck.release = resolve));
  };
  return { stuck, never };
}

/** An `onOpenExternal` that records each URL in `into` and answers that the app opened it. */
export const recordExternal =
  (into: string[]): WebViewProps['onOpenExternal'] =>
  ({ url }) => {
    into.push(url);
    return true;
  };
/** Allows every `ask`, with `rules` ahead of a catch-all http(s) allow; returns the asked URLs. */
const allowAsks = async (h: Harness, rules: NavigationRule[]) => {
  const asked: string[] = [];
  h.setAsk((request) => {
    asked.push(request.url);
    return 'allow';
  });
  h.setRules([...rules, { scheme: ['http', 'https'], action: 'allow' }]);
  await sleep(300);
  return asked;
};
/** The height of a 100vh element: 0 when the WebView loaded the page before it had a size. */
const viewportHeight = async (h: Harness) =>
  (await h.ref.current?.evaluate(
    `(() => { const d = document.createElement('div'); d.style.height = '100vh'; document.body.append(d); const v = d.offsetHeight; d.remove(); return v; })()`
  )) as number;
const href = async (h: Harness) => (await h.ref.current?.evaluate('location.href')) as string;
/** A click from script on `id`; with `frame`, on an element in that same-origin iframe. */
export const click = (h: Harness, id: string, frame?: string) =>
  h.ref.current?.evaluate(
    `${frame ? `document.getElementById(${JSON.stringify(frame)}).contentDocument` : 'document'}.getElementById(${JSON.stringify(id)}).click()`
  );

/** Committed url and the page's location.href agree, once the coalesced state event has arrived. */
async function agree(h: Harness, r: ReturnType<typeof reporter>, name: string) {
  let seen = {};
  const agreed = await until(
    async () => {
      const page = await href(h);
      const { url } = h.state();
      seen = { url, href: page };
      return url === page;
    },
    2000,
    50
  );
  r.check(name, agreed === true, seen);
}

async function urlTracking(h: Harness) {
  const r = reporter('urlTracking');
  // An app-started load is pending until it commits: never reported as the loaded, idle page before it starts. The
  // gap is widest right after launch (the web process is still starting), which is when this suite's first load runs.
  const first = fresh(h, '/spa.html');
  const loadsBefore = h.events.loads.length;
  h.load(first);
  let early: NavigationState | null = null;
  for (
    const end = Date.now() + 10000;
    Date.now() < end && !h.events.loads.slice(loadsBefore).includes('start');
  ) {
    const s = h.state();
    if (s.url === first && idle(s)) early = s;
    await sleep(10);
  }
  r.check('a new source is not reported loaded before it starts', early === null, early);
  r.check('initial load', await waitFor(h, (s) => s.url === first && idle(s)), h.state());
  await agree(h, r, 'initial load agrees');

  for (const [id, expected] of [
    ['push', '/spa/pushed'],
    ['replace', '/spa/replaced'],
    ['hash', '#h'],
  ] as const) {
    await click(h, id);
    r.check(
      `${id} updates url`,
      await waitFor(h, (s) => s.url.includes(expected), 3000),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }
  const beforeBack = h.state().url;
  await click(h, 'back');
  r.check(
    'history.back updates url',
    await waitFor(h, (s) => s.url !== beforeBack, 3000),
    h.state()
  );
  await agree(h, r, 'history.back agrees');

  const beforeFrame = h.state().url;
  await click(h, 'frame-push');
  await sleep(1000);
  r.check('iframe pushState leaves url alone', h.state().url === beforeFrame, h.state());

  for (const [id, expected] of [
    ['redirect', 'from=redirect'],
    ['redirect301', 'from=301'],
    ['chain', 'from=chain'],
  ] as const) {
    await click(h, id);
    r.check(
      `${id} lands on the final url`,
      await waitFor(h, (s) => s.url.includes(expected) && idle(s)),
      h.state()
    );
    await agree(h, r, `${id} agrees`);
  }

  const beforeSlow = h.state().url;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await waitFor(h, (s) => (s.pendingUrl ?? '').includes('/slow'), 1000);
  const during = h.state();
  r.info('during slow load', {
    url: during.url,
    pendingUrl: during.pendingUrl,
    loading: during.loading,
  });
  r.check('url keeps the committed page while loading', during.url === beforeSlow, during);
  r.since(
    WEBVIEW.navigationListener,
    'pendingUrl shows the in-flight url',
    (during.pendingUrl ?? '').includes('/slow'),
    during
  );
  r.check(
    'slow load commits',
    await waitFor(h, (s) => s.url.includes('/slow') && idle(s)),
    h.state()
  );
  await agree(h, r, 'slow load agrees');

  // The page being left fires its load event (its slow image is done) while the next page is still pending.
  await h.ref.current?.evaluate(`location.href = '/slow-image.html?t=${Date.now()}'`);
  await until(async () => (await text(h, 'old').catch(errorCode)) === 'old', 5000);
  const leaving = h.events.loads.length;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await sleep(2500);
  r.check(
    "the page being left doesn't end the pending load",
    h.state().loading && !h.events.loads.slice(leaving).includes('end'),
    { state: h.state(), loads: h.events.loads.slice(leaving) }
  );
  await waitFor(h, (s) => s.url.includes('/slow') && idle(s));

  // After a remount that doesn't re-render App, useWebViewState and getState() follow the new WebView, which loads the
  // source again, instead of keeping the old one's /slow page.
  const beforeRemount = h.state().url;
  h.remount();
  await sleep(0);
  r.check('a remount resets the state', h.state().url !== beforeRemount, h.state());
  r.check(
    'useWebViewState follows the remounted WebView',
    await waitFor(h, (s) => s.url === first && idle(s)),
    h.state()
  );
  r.check('getState() is the same state', h.ref.getState() === h.state(), h.ref.getState());
  await agree(h, r, 'remounted WebView agrees');
  r.done();
}

/** Runs `act`, then waits for what onNavigation reports about a URL ending in `path`: that, or undefined after 3 s. */
async function nextDecision(h: Harness, act: () => unknown, path: string) {
  const before = h.events.navigations.length;
  await act();
  return await until(
    () => h.events.navigations.slice(before).find((n) => n.url.endsWith(path)),
    3000
  );
}

// The `ask` rule (NavigationRule.action).
async function reissue(h: Harness) {
  const r = reporter('reissue');
  const asked: string[] = [];
  let answer: 'allow' | 'block' | 'late' = 'allow';
  const ask = async (url: string): Promise<'allow' | 'block'> => {
    asked.push(url);
    if (answer === 'late') await sleep(1500);
    return answer === 'block' ? 'block' : 'allow';
  };
  // The handler's answer to the latest ask: it settles once the handler has answered.
  let answered: Promise<unknown> = Promise.resolve();
  h.setAsk((request) => (answered = ask(request.url)));
  h.setRules([
    { host: ['localhost', '127.0.0.1'], path: ['/checkout', '/headers'], action: 'ask' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const start = fresh(h, '/nav.html');
  await openPage(h, start);
  const startDepth = await h.ref.current?.evaluate('history.length');

  await click(h, 'checkout');
  r.check(
    'allow reissues the navigation',
    await waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 5000),
    h.state()
  );
  r.check('asked once', asked.length === 1, asked);
  r.info('request', asked[0]);
  const depth = await h.ref.current?.evaluate('history.length');
  r.check('one history entry added', depth === (startDepth as number) + 1, { startDepth, depth });
  h.ref.current?.goBack();
  r.check(
    'goBack returns to the start page',
    await waitFor(h, (s) => s.url === start && idle(s), 5000),
    h.state()
  );

  const checkout = () => nextDecision(h, () => click(h, 'checkout'), '/checkout/pay');
  answer = 'block';
  const blocked = await checkout();
  r.check(
    'block stays on the page',
    blocked?.action === 'block' && h.state().url === start && asked.length === 2,
    { decision: blocked, url: h.state().url, asked }
  );

  // The timeout blocks after 1 s, before the handler answers allow.
  answer = 'late';
  const timedOut = await checkout();
  await answered;
  await sleep(1000); // a load the late allow wrongly started would have committed by now
  r.check(
    'a late answer is ignored (timeout blocks)',
    timedOut?.action === 'block' && h.state().url === start && asked.length === 3,
    { decision: timedOut, url: h.state().url, asked }
  );

  answer = 'allow';
  await h.ref.current?.evaluate(`location.href = '/redirect?to=/checkout/pay%3Ffrom%3Dredirect'`);
  const redirected = await waitFor(h, (s) => s.url.includes('from=redirect') && idle(s), 5000);
  r.check('a redirect into an ask rule is asked and reissued', redirected && asked.length === 4, {
    url: h.state().url,
    asked,
  });

  const beforeFrame = asked.length;
  await h.ref.current?.evaluate(
    `(() => { const f = document.createElement('iframe'); f.src = '/checkout/frame'; document.body.append(f); f.onload = () => f.contentWindow.location.href = '/checkout/frame2'; })()`
  );
  await until(() => asked.length > beforeFrame, 1500); // on Android, where none must come, the whole 1.5 s
  if (Platform.OS === 'android') {
    r.check(
      'http(s) iframe navigations are not decided on Android',
      asked.length === beforeFrame,
      asked
    );
  } else {
    r.check('iframe navigations into an ask rule are asked', asked.length > beforeFrame, asked);
  }

  const referrerTo = async (target: string) => {
    const from = fresh(h, '/nav.html');
    await openPage(h, from);
    await h.ref.current?.evaluate(`location.href = '${target}'`);
    await waitFor(h, (s) => s.url === target && idle(s), 5000);
    const headers = (await h.ref.current?.evaluate(
      `JSON.parse(document.getElementById('headers').textContent)`
    )) as { referer?: string } | undefined;
    return { from, referer: headers?.referer };
  };
  const same = await referrerTo(`${h.pages}/headers?r=same`);
  r.check('an allowed navigation keeps the referrer', same.referer === same.from, same);
  const cross = await referrerTo('http://127.0.0.1:8090/headers?r=cross');
  r.check('cross-origin, the referrer is the origin', cross.referer === `${h.pages}/`, cross);
  r.done();
}

export const errorCode = (error: unknown) => (error as { code?: string }).code;

/** Starts a page-side `nativeBridge.call` and waits for its outcome; `script_error` on a page without the bridge. */
async function pageCall(h: Harness, method: string, params: unknown) {
  const start = `(() => {
    window.__call = undefined;
    nativeBridge.call(${JSON.stringify(method)}, ${JSON.stringify(params)}).then(
      (result) => (window.__call = { result }),
      (error) => (window.__call = { error: error.code })
    );
  })()`;
  const error = await h.ref.current?.evaluate(start).then(() => undefined, errorCode);
  if (error) return { error };
  const outcome = await until(() => h.ref.current?.evaluate('window.__call'), 6000, 100);
  return (outcome ?? { error: 'harness timeout' }) as { result?: unknown; error?: string };
}

async function bridge(h: Harness) {
  const r = reporter('bridge', WEBVIEW.bridge);
  const page = fresh(h, '/bridge.html');
  await openPage(h, page);
  const bridgeType = await h.ref.current?.evaluate(
    '[typeof window.nativeBridge, location.href, document.readyState]'
  );
  r.check('page sees window.nativeBridge', (bridgeType as string[])?.[0] === 'object', {
    bridgeType,
    state: h.state(),
  });

  const evaluate = (script: string) => h.ref.current?.evaluate(script);
  const plain = await evaluate(`({ n: 1 + 1, s: 'x', a: [true, null] })`);
  r.since(
    WEBVIEW.evaluate,
    'evaluate returns a plain value',
    JSON.stringify(plain) === '{"n":2,"s":"x","a":[true,null]}',
    plain
  );
  const awaited = await evaluate(
    `new Promise((resolve) => setTimeout(() => resolve('late'), 300))`
  );
  r.since(WEBVIEW.evaluate, 'evaluate awaits a Promise', awaited === 'late', awaited);
  const unencodable = await Promise.all(
    ['() => 1', 'NaN', '(() => { const o = {}; o.o = o; return o; })()'].map(evaluate)
  );
  r.since(
    WEBVIEW.evaluate,
    'evaluate gives null for what JSON cannot encode',
    unencodable.every((v) => v === null),
    unencodable
  );
  const thrown = (await Promise.all(
    [`(() => { throw new Error('boom'); })()`, `Promise.reject(new Error('no'))`, '1 +'].map((s) =>
      evaluate(s)?.catch((e: unknown) => ({ code: errorCode(e), message: (e as Error).message }))
    )
  )) as ({ code?: string; message: string } | undefined)[];
  r.since(
    WEBVIEW.evaluate,
    'evaluate rejects script_error on a throw, a rejection or a syntax error',
    thrown.every((c) => c?.code === 'script_error'),
    thrown
  );
  r.since(
    WEBVIEW.evaluate,
    "evaluate rejects with the thrown error's message",
    String(thrown[0]?.message).includes('boom'),
    thrown[0]
  );

  const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
  r.check('RN -> page call', sum === 5, sum);
  const slowPage = await h.bridge.call('pageSlow').catch(errorCode);
  r.check('RN -> page awaits a page Promise', slowPage === 'late', slowPage);
  const missing = await h.bridge.call('nope').catch(errorCode);
  r.check('RN -> page missing method rejects not_found', missing === 'not_found', missing);

  const echo = await pageCall(h, 'echo', { x: 1, s: 'quote\' "' });
  const echoed = echo.result as { x?: number; s?: string } | undefined;
  r.check('page -> RN call', echoed?.x === 1 && echoed.s === 'quote\' "', echo);
  const failed = await pageCall(h, 'fail', null);
  r.check('page -> RN handler error', failed.error === 'handler_error', failed);
  const notFound = await pageCall(h, 'nope', null);
  r.check('page -> RN missing method', notFound.error === 'not_found', notFound);
  const slow = await pageCall(h, 'slow', null);
  r.check('page -> RN call times out', slow.error === 'timeout', slow);
  const unhandle = h.bridge.handle('sender', (_, sender) => sender);
  const sender = await pageCall(h, 'sender', null);
  unhandle();
  r.check(
    "page -> RN handler gets the caller's origin from native",
    (sender.result as { origin?: string } | undefined)?.origin === h.pages,
    sender
  );

  h.bridge.emit('nativeEvent', { n: 1 });
  const logged = await until(
    () => h.ref.current?.evaluate(`window.testLog.some((line) => line.startsWith('nativeEvent'))`),
    3000
  );
  r.check('RN -> page event', logged === true);
  const before = h.pageEvents.length;
  await h.ref.current?.evaluate(`nativeBridge.emit('pageEvent', { n: 2 })`).catch(errorCode);
  await waitFor(h, () => h.pageEvents.length > before, 3000);
  await sleep(200); // a duplicate would come right after
  r.check('page -> RN event', h.pageEvents.length === before + 1, h.pageEvents);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  const pending = evaluate('new Promise(() => {})')?.catch(errorCode);
  await sleep(200);
  h.load(`${page}&next=1`);
  const cutOff = await inFlight;
  r.check('navigation rejects calls in flight', cutOff === 'navigated', cutOff);
  const gone = await pending;
  r.since(WEBVIEW.evaluate, 'navigation rejects an evaluate in flight', gone === 'navigated', gone);
  await waitFor(h, (s) => s.url.includes('next=1') && idle(s));
  const again = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('the bridge works again after navigation', again === 2, again);

  // The new page's first message is a head script's call. Android ends the old Document (and drops its reply proxy) one
  // main-thread hop after the commit: that has to come first, or the answer is lost and JS takes the page as loading.
  const head = `${page}&head=1`;
  await openPage(h, head);
  const headCall = await until(() => h.ref.current?.evaluate('window.__head'), 5000);
  r.check(
    "a head script's call at document start is answered",
    (headCall as { result?: { head?: boolean } } | undefined)?.result?.head === true,
    headCall
  );
  const afterHead = await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode);
  r.check("RN -> page calls work after a head script's call", afterHead === 4, afterHead);

  const early = `${page}&early=1`;
  h.load(early);
  await waitFor(h, (s) => s.url === early);
  const duringLoad = await h.bridge.call('early').catch(errorCode);
  r.check(
    'a call made during load reaches a handler the page registers while loading',
    duringLoad === 'early-ok',
    duringLoad
  );
  await waitFor(h, idle);

  const other = fresh(h, 'http://127.0.0.1:8090/bridge.html');
  await openPage(h, other);
  r.check(
    'no bridge for an origin outside allowedOrigins',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'undefined'
  );
  const blocked = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('calls to a disallowed page time out', blocked === 'timeout', blocked);

  if (Platform.OS === 'ios') {
    const unmounted = evaluate('new Promise(() => {})')?.catch(errorCode);
    await sleep(200);
    h.remount();
    const closed = await Promise.race([unmounted, sleep(3000).then(() => 'still pending')]);
    r.check('unmount rejects an evaluate in flight', closed === 'navigated', closed);
  }
  r.done();
}

/**
 * The `pullToRefresh` prop. The gesture comes from outside the app: the suite asks for `SWIPE "<kind>"` and the driver
 * (maestro/ptr.yaml) performs it.
 */
async function ptr(h: Harness) {
  const r = reporter('ptr');
  // The evaluate rejects with `navigated` when the pull's reload replaces the page mid-call; the next poll retries.
  const loadedAt = async () =>
    (await h.ref.current
      ?.evaluate(`document.getElementById('loaded').textContent`)
      .catch(() => null)) as string | null;
  const open = async (mode: string) => {
    await openPage(h, fresh(h, `/ptr.html?mode=${mode}`));
    await sleep(200);
  };
  const pull = async (kind: string) => {
    const before = await loadedAt();
    r.info('SWIPE', kind);
    return !!(await until(
      async () => idle(h.state()) && (await loadedAt()) !== before,
      10000,
      250
    ));
  };
  /**
   * A pull that must not reload. It has landed once it scrolls `position` (the page or the inner scroller) up by more than
   * 30 px (a pull moves it 90 px or more), and a reload it wrongly started would follow within a second (the release,
   * then the refresh). Waiting from the landing rather than from the request also fails a pull that never came.
   */
  const pullStays = async (kind: string, position: string) => {
    const at = async () => (await h.ref.current?.evaluate(position)) as number;
    // iOS keeps moving the page for a moment after a scrollTo while the last pull's refresh control hides: start from
    // where it holds still.
    let top = await at();
    for (
      let since = Date.now(), end = since + 5000;
      Date.now() - since < 500 && Date.now() < end;
    ) {
      await sleep(100);
      const now = await at();
      if (now !== top) [top, since] = [now, Date.now()];
    }
    const [loads, was] = [h.events.loads.length, await loadedAt()];
    const reloaded = async () => h.events.loads.length > loads || (await loadedAt()) !== was;
    const scrolled = async () => {
      const now = await h.ref.current?.evaluate(position).catch(errorCode);
      return typeof now === 'number' && now < top - 30;
    };
    r.info('SWIPE', kind);
    const landed = await until(async () => (await reloaded()) || (await scrolled()), 15000);
    if (landed) await until(reloaded, 3000);
    return (await reloaded()) ? 'reloaded' : landed ? 'stayed' : 'the pull never came';
  };

  await open('long');
  r.check('pull at the top of a long page reloads', await pull('full'));
  await open('short');
  r.check('pull on a short page reloads', await pull('full'));
  await open('long');
  await h.ref.current?.evaluate('window.scrollTo(0, 1500)');
  const short = await pullStays('short', 'window.scrollY');
  r.check('a short pull while scrolled down does not reload', short === 'stayed', short);
  r.info('scrollY after the pull', await h.ref.current?.evaluate('window.scrollY'));
  await open('inner');
  await h.ref.current?.evaluate(`document.getElementById('scroller').scrollTop = 400`);
  const inner = await pullStays('inner', `document.getElementById('scroller').scrollTop`);
  r.check('a pull inside a scrolled inner scroller does not reload', inner === 'stayed', inner);
  // With the prop off, the layout stays around the WebView but takes no pull. The next setProps turns it back on (the
  // app's default), which the failing reload's pull below needs.
  h.setProps({ pullToRefresh: false });
  await open('long');
  r.check('no pull to refresh while the prop is off', !(await pull('full')));

  // A reload that fails must end the refresh, or the control stays refreshing and ignores the next pull.
  // The example's error screen would cover the WebView and take the next pull: keep its onError out of the way.
  h.setProps({ onError: (event) => h.events.errors.push(event) });
  const key = Date.now();
  const dropping = `${h.pages}/drop?key=${key}`;
  await openPage(h, dropping);
  await sleep(200);
  clearEvents(h);
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  // Wait for the error, not for a new page: iOS keeps the old one when the reload fails.
  r.info('SWIPE', 'full');
  r.check(
    'a pull whose reload fails reports the error',
    await waitFor(h, () => h.events.errors.some((e) => e.kind === 'network'), 15000),
    h.events.errors
  );
  await waitFor(h, idle, 5000);
  await fetch(`${h.pages}/drop/set?key=${key}&fail=0`);
  await sleep(1000);
  r.check('the next pull after a failed reload works', await pull('full'));
  r.done();
}

/**
 * Android file chooser through onFileRequest: the app answers with URIs it got from an Expo API. Without the prop, the
 * system chooser. The taps come from outside (`INFO upload: TAP`), because WebView only opens choosers on a real gesture.
 */
async function upload(h: Harness) {
  const r = reporter('upload');
  if (Platform.OS !== 'android') {
    r.info('skipped', 'onFileRequest is Android only');
    r.done();
    return;
  }
  const file = new File(Paths.cache, 'upload-test.txt');
  file.create({ overwrite: true });
  file.write('hello from the app cache');
  const requests: FileRequest[] = [];
  let answer: string[] | null = null;
  let hang = false;
  const { stuck, never } = stuckHandler<null>();
  h.setFileRequest(async (request, signal) => {
    requests.push(request);
    return hang ? await never(signal) : answer;
  });
  const open = async () => {
    await openPage(h, fresh(h, '/upload.html'));
    await sleep(200);
  };
  await open();
  const tapAndRead = async (label: string) =>
    (await pageLog(h, () => r.info('TAP', label)))?.join(' | ') ?? null;

  answer = [file.uri];
  const fromFileUri = await tapAndRead('file uri');
  r.info('file:// URI', file.uri);
  r.check(
    'a file:// URI from the app cache uploads (allowFileAccess off)',
    fromFileUri?.includes('hello from the app cache') ?? false,
    fromFileUri
  );
  r.check(
    'the request carries accept, multiple and capture',
    requests[0]?.accept.join() === 'text/plain,image/*' &&
      requests[0].multiple === false &&
      requests[0].capture === false,
    requests[0]
  );

  answer = [await getContentUriAsync(file.uri)];
  const fromContentUri = await tapAndRead('content uri');
  r.info('content:// URI', answer[0]);
  r.check(
    'a content:// URI (FileProvider) uploads',
    fromContentUri?.includes('hello from the app cache') ?? false,
    fromContentUri
  );

  answer = null;
  const cancelled = await tapAndRead('cancel');
  r.info('after cancel the page logged', cancelled);
  answer = [file.uri];
  const again = await tapAndRead('after cancel');
  r.check(
    'the chooser opens again after a cancel (callback called once)',
    again?.includes('hello') ?? false,
    again
  );

  // A handler that never settles holds the page's chooser (WebView allows one); the next page cancels it and aborts
  // the handler's signal.
  hang = true;
  const held = requests.length;
  r.info('TAP', 'never settles');
  await until(() => requests.length > held, 10000, 200);
  r.check(
    'a request whose handler never settles reaches JS',
    requests.length === held + 1,
    requests.length - held
  );
  hang = false;
  const navigatedAt = Date.now();
  await open();
  await until(() => stuck.abortedAt, 2000);
  r.check(
    "navigating away aborts the held handler's signal",
    stuck.abortedAt >= navigatedAt,
    stuck.abortedAt ? stuck.abortedAt - navigatedAt : 'not aborted'
  );
  const afterHang = await tapAndRead('after navigation');
  r.check(
    'after navigating, the next request reaches JS and uploads',
    requests.length === held + 2 && (afterHang?.includes('hello') ?? false),
    { requests: requests.length - held, afterHang }
  );

  // Without onFileRequest: the system chooser. It covers the app (AppState goes background); the driver presses back.
  h.setProps({ onFileRequest: undefined });
  const states: string[] = [];
  const subscription = AppState.addEventListener('change', (state) => states.push(state));
  for (const label of ['system chooser', 'system chooser again']) {
    states.length = 0;
    const logged = await tapAndRead(label);
    r.check(
      `without onFileRequest the system chooser opens (${label})`,
      states.includes('background'),
      states
    );
    r.since(
      WEBVIEW.fileInputCancel,
      `back cancels it (${label})`,
      logged?.includes('cancelled') ?? false,
      logged
    );
  }
  subscription.remove();
  h.setProps({});
  const restored = await tapAndRead('onFileRequest again');
  r.check(
    'onFileRequest set again takes over without a remount',
    restored?.includes('hello') ?? false,
    restored
  );
  r.done();
}

const clearEvents = (h: Harness) => {
  for (const log of Object.values(h.events)) if (Array.isArray(log)) log.length = 0;
  h.pageEvents.length = 0;
};

/** A test page's URL with a cache-buster: `path` on the test pages server, or a full URL. */
export const fresh = (h: Harness, path: string) =>
  `${path.startsWith('http') ? '' : h.pages}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;

/**
 * Sets props that recreate the WebView (a creation-time setting) and waits until the new one has loaded its page. With
 * `remount`, it remounts too, for props that don't recreate it, such as an `extensions` entry whose hook has a
 * `configure` step or its own WebView class: that hook attaches only when the WebView is created.
 */
export async function recreate(h: Harness, props: HarnessProps, remount = false) {
  return await waitForLoad(h, () => {
    h.setProps(props);
    if (remount) h.remount();
  });
}

/** Loads `page`, a URL or a source with one, and waits until it is the idle page and its load has ended. */
export async function openPage(
  h: Harness,
  page: string | Extract<WebViewSource, { uri: string }>,
  ms = 15000
) {
  const source = typeof page === 'string' ? { uri: page } : page;
  const ok = await waitForLoad(
    h,
    () => h.loadSource(source),
    (s) => s.url === source.uri && idle(s),
    ms
  );
  await sleep(100); // events the native side sends right after onLoadEnd (onNavigation, an extension's)
  return ok;
}

/** Runs `act`, then waits for the lines the page adds to `window.testLog`; null when none come within `ms`. */
export async function pageLog(h: Harness, act: () => unknown, ms = 10000) {
  const before = ((await h.ref.current?.evaluate('window.testLog.length')) as number) ?? 0;
  await act();
  return (
    (await until(async () => {
      const lines = await h.ref.current
        ?.evaluate(`(window.testLog ?? []).slice(${before})`)
        .catch(String);
      return Array.isArray(lines) && lines.length ? (lines as string[]) : undefined;
    }, ms)) ?? null
  );
}

/** An element's text, '' when it is missing. */
export const text = async (h: Harness, id: string) =>
  (await h.ref.current?.evaluate(
    `document.getElementById(${JSON.stringify(id)})?.textContent ?? ''`
  )) as string;

/**
 * The screen point of an element's centre, `x y`, for a driver's TAP: pixels on Android, points on iOS; with `frame`,
 * of an element inside that same-origin iframe. On iOS WebKit starts the page below the part of the WebView that is
 * under the status bar, so innerHeight falls short of the WebView's height by that much (nothing covers its bottom).
 */
export const tapPoint = async (h: Harness, id: string, frame?: string) =>
  (
    (await h.ref.current?.evaluate(`(() => {
    const f = ${frame ? `document.getElementById(${JSON.stringify(frame)})` : 'null'};
    const e = (f ? f.contentDocument : document).getElementById(${JSON.stringify(id)});
    (f ?? e).scrollIntoView({ block: 'center' });
    const fr = f?.getBoundingClientRect(), x = fr ? fr.left + f.clientLeft : 0, y = fr ? fr.top + f.clientTop : 0;
    const b = e.getBoundingClientRect(), d = ${Platform.OS === 'android' ? 'devicePixelRatio' : 1};
    const top = ${Platform.OS === 'android' ? 0 : `Math.max(0, ${h.webViewOffset.height} - innerHeight)`};
    return [
      Math.round((${h.webViewOffset.x} + x + b.left + b.width / 2) * d),
      Math.round((${h.webViewOffset.y} + top + y + b.top + b.height / 2) * d),
    ];
  })()`)) as [number, number]
  ).join(' ');

/**
 * A user gesture on `id` (with `frame`, on an element in that same-origin iframe): the driver's real tap on Android,
 * asked for with a `TAP` request; a click from script on iOS, which WebKit runs as a gesture but the core doesn't count
 * as `userInitiated`. A click on a page that went away shows in the check that follows.
 */
export async function tap(h: Harness, r: ReturnType<typeof reporter>, id: string, frame?: string) {
  if (Platform.OS === 'android') r.info('TAP', await tapPoint(h, id, frame));
  else await click(h, id, frame)?.catch(errorCode);
}

/**
 * The driver's real tap on `id` (with `frame`, on an element in that same-origin iframe), asked for with a `TAP`
 * request. A check that needs `userInitiated` uses it on iOS too, where the core counts a link only after a touch.
 */
export async function touch(
  h: Harness,
  r: ReturnType<typeof reporter>,
  id: string,
  frame?: string
) {
  r.info('TAP', await tapPoint(h, id, frame));
}

/**
 * Main-frame errors only, the URL after a failure, how each kind of load ends (`outcome`), the example's error screen
 * (the recipe in guides/examples.md#loading-and-error-screens), and reload recovering.
 */
async function errors(h: Harness) {
  const r = reporter('errors');
  await openPage(h, fresh(h, '/'));
  /** Runs `act`, then waits for the next load to end: its outcome, or 'no end' after `ms`. */
  const outcomeOf = async (act: () => unknown, ms = 10000) => {
    const n = h.events.outcomes.length;
    await act();
    await until(() => h.events.outcomes.length > n, ms, 50);
    return h.events.outcomes.length > n ? h.events.outcomes[n] : 'no end';
  };

  clearEvents(h);
  const unreachable = 'http://localhost:8099/nothing'; // nothing listens there
  h.load(unreachable);
  const gotNetwork = await waitFor(h, () => h.events.errors.length > 0, 10000);
  await waitFor(h, idle, 5000);
  await sleep(500);
  const network = h.events.errors[0];
  r.check('network error', gotNetwork && network?.kind === 'network', network);
  r.check('url is the failed url', h.state().url === unreachable, h.state());
  r.check(
    'a failed load ends once, as failed',
    JSON.stringify(h.events.outcomes) === '["failed"]',
    { loads: h.events.loads, outcomes: h.events.outcomes }
  );
  r.check(
    'the error screen is shown after a failure',
    await waitFor(h, () => h.events.overlay.error, 3000)
  );

  clearEvents(h);
  const notFound = await outcomeOf(() => h.load(fresh(h, '/status/404')));
  await waitFor(h, () => h.events.errors.length > 0, 3000);
  const http = h.events.errors[0];
  r.check(
    'http error with the status code',
    http?.kind === 'http' && http.statusCode === 404,
    http
  );
  r.check('an http error is the only error', h.events.errors.length === 1, h.events.errors);
  r.check('a 404 page ends as finished', notFound === 'finished', notFound);
  r.check(
    'the error screen goes away on the next load',
    await waitFor(h, () => !h.events.overlay.error, 3000)
  );

  clearEvents(h);
  await openPage(h, fresh(h, '/subresource-404.html'));
  await sleep(1000);
  r.check('subresource 404s are not reported', h.events.errors.length === 0, h.events.errors);
  r.check(
    'a clean load ends as finished',
    JSON.stringify(h.events.outcomes) === '["finished"]',
    h.events.outcomes
  );

  const stopped = await outcomeOf(async () => {
    h.load(fresh(h, '/slow?ms=3000'));
    await waitFor(h, (s) => s.loading, 3000);
    h.ref.current?.stopLoading();
  }, 5000);
  r.since(
    WEBVIEW.navigationListener,
    'a stopped load ends as cancelled',
    stopped === 'cancelled',
    stopped
  );
  // A load replaced before it commits: iOS keeps loading into the newer one.
  clearEvents(h);
  h.load(fresh(h, '/slow?ms=3000'));
  await waitFor(h, (s) => s.loading, 3000);
  const newer = fresh(h, '/');
  h.load(newer);
  await waitFor(h, (s) => s.url === newer && idle(s), 10000);
  await sleep(500);
  const replaced = JSON.stringify({ loads: h.events.loads, outcomes: h.events.outcomes });
  const expectedReplaced =
    Platform.OS === 'ios'
      ? '{"loads":["start","end"],"outcomes":["finished"]}'
      : '{"loads":["start","end","start","end"],"outcomes":["cancelled","finished"]}';
  r.since(
    WEBVIEW.navigationListener,
    'a load replaced before it commits',
    replaced === expectedReplaced,
    replaced
  );
  const noContent = await outcomeOf(() => h.load(fresh(h, '/status/204')), 5000);
  // WebKit 298028@main stops a 204 for a policy change instead of finishing it; first in Safari 26.2 (20623.1.14).
  const expected204 =
    Platform.OS === 'ios' && parseFloat(String(Platform.Version)) < 26.2 ? 'finished' : 'cancelled';
  r.since(
    WEBVIEW.navigationListener,
    `a 204 ends as ${expected204}`,
    noContent === expected204,
    noContent
  );
  h.setRules([
    { path: ['/blocked'], action: 'block' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const blocked = await outcomeOf(
    () => h.ref.current?.evaluate(`location.href = '/redirect?to=/blocked'`),
    5000
  );
  r.since(
    WEBVIEW.navigationListener,
    'a redirect the rules block ends as cancelled',
    blocked === 'cancelled',
    blocked
  );
  h.setRules(undefined);

  clearEvents(h);
  const flaky = `${h.pages}/flaky?key=${Date.now()}`;
  h.load(flaky);
  await waitFor(h, () => h.events.errors.length > 0 && idle(h.state()), 10000);
  const unavailable = h.events.errors[0];
  r.check(
    '503 reported',
    unavailable?.kind === 'http' && unavailable.statusCode === 503,
    unavailable
  );
  h.events.outcomes.length = 0;
  h.ref.current?.reload();
  const reloaded = await waitFor(h, () => h.events.outcomes.includes('finished'), 10000);
  r.check('reload after an error loads the page', reloaded && h.state().url === flaky, {
    outcomes: h.events.outcomes,
    state: h.state(),
  });
  r.check('the reload reports no new error', h.events.errors.length === 1, h.events.errors);

  // An app's retry button: reload() after a network failure fetches the failed URL again.
  clearEvents(h);
  const key = `retry${Date.now()}`;
  const dropping = `${h.pages}/drop?key=${key}`;
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  h.load(dropping);
  await waitFor(h, (s) => h.events.errors.length > 0 && s.url === dropping && idle(s), 10000);
  const dropped = h.events.errors[0];
  r.check(
    'a dropped connection is a network error',
    dropped?.kind === 'network' && h.state().outcome === 'failed',
    { dropped, state: h.state() }
  );
  await fetch(`${h.pages}/drop/set?key=${key}&fail=0`);
  const retried = await outcomeOf(() => h.ref.current?.reload());
  await waitFor(h, idle, 5000);
  r.check(
    'reload() after a network error loads the failed url',
    retried === 'finished' && h.state().url === dropping && h.events.errors.length === 1,
    { retried, state: h.state(), errors: h.events.errors }
  );

  // Page-initiated, then through a redirect: on Android these reach the SSL check through shouldOverrideUrlLoading.
  for (const [name, to, failed] of [
    ['ssl error from the page', `'https://localhost:8443/link'`, 'https://localhost:8443/link'],
    [
      'ssl error after a redirect',
      `'/redirect?to=https://localhost:8443/redirected'`,
      'https://localhost:8443/redirected',
    ],
  ]) {
    await openPage(h, fresh(h, '/'));
    clearEvents(h);
    await h.ref.current?.evaluate(`location.href = ${to}`);
    const got = await waitFor(h, () => h.events.errors.length > 0, 10000);
    r.check(
      name,
      got && h.events.errors[0]?.kind === 'ssl' && h.events.errors[0]?.url === failed,
      h.events.errors[0]
    );
  }
  r.done();
}

/** The app name appended through the platform keys (the example's `ios` and `android` props) reaches the server; userAgent replaces it. */
async function ua(h: Harness) {
  const r = reporter('ua');
  const read = async () => {
    await openPage(h, fresh(h, '/ua'));
    return {
      header: await text(h, 'ua'),
      navigator: (await h.ref.current?.evaluate('navigator.userAgent')) as string,
    };
  };
  const suffixed = await read();
  r.check(
    'the app name is appended (header)',
    suffixed.header.endsWith(' MinimalWebViewExample/1.0'),
    suffixed
  );
  r.check(
    'navigator.userAgent matches the header',
    suffixed.navigator === suffixed.header,
    suffixed
  );
  const native = () => h.ref.current?.get(USER_AGENT_KEY).catch(errorCode);
  h.setProps({ userAgent: 'CustomAgent/2.0' });
  await until(async () => (await native()) === 'CustomAgent/2.0', 3000);
  const custom = await read();
  r.check(
    'userAgent replaces the whole UA',
    custom.header === 'CustomAgent/2.0' && custom.navigator === 'CustomAgent/2.0',
    custom
  );
  h.setProps({});
  await until(async () => (await native()) !== 'CustomAgent/2.0', 3000);
  const back = await read();
  r.check(
    'removing userAgent restores the default',
    back.header.endsWith(' MinimalWebViewExample/1.0'),
    back
  );
  r.done();
}

/** Kill the web content process: the core reloads, the bridge works again, and a crash loop stops reloading. */
async function crash(h: Harness) {
  const r = reporter('crash');
  const page = fresh(h, '/bridge.html');
  /** Asks the driver for kill `n` (`request`: what it does around the kill) and waits for its onProcessGone. */
  const kill = async (n: number, request = 'KILL') => {
    const before = h.events.gone.length;
    // Kill only a live renderer: an evaluate round trip needs one (a kill during recovery would find none).
    // An evaluate that the recovery's navigation rejects also proves nothing yet: wait for one that answers.
    const answers = () =>
      Promise.race([
        h.ref.current?.evaluate('1').then(
          () => true,
          () => false
        ),
        sleep(1000).then(() => false),
      ]);
    await until(answers);
    // Android counts renderer deaths within 100 ms as one crash (SAME_CRASH_MS); a fast recovery gets there first.
    await sleep(150);
    r.info(request, n);
    await waitFor(h, () => h.events.gone.length > before, 15000);
    return h.events.gone[before];
  };
  // A setting the page can see, to check after recovery.
  const userAgent = () =>
    until(
      async () =>
        (await h.ref.current?.evaluate('navigator.userAgent').catch(errorCode)) === 'Crash/1'
    );
  h.setProps({ userAgent: 'Crash/1' });
  await until(
    async () => (await h.ref.current?.get(USER_AGENT_KEY).catch(errorCode)) === 'Crash/1'
  );
  await openPage(h, page);
  r.info('a setting before the crash', await userAgent());
  clearEvents(h);
  const firstKillAt = Date.now();
  const countsBefore = h.events.pageCounts.length;
  let first: ProcessGoneEvent | undefined;
  const reloaded = await waitForLoad(
    h,
    async () => (first = await kill(1)),
    (s) => s.url === page && idle(s)
  );
  r.check('processGone reported and recovered', first?.recovered === true, first);
  r.check('the page reloads', reloaded, h.state());
  // A page other than the source reloads its history entry in place: back still goes to the page before it, and
  // forward from there to it (Android restores the dead WebView's history into the new one). This is the second of
  // the crash loop's kills.
  const second = fresh(h, '/bridge.html');
  await waitForLoad(
    h,
    () => h.ref.current?.evaluate(`location.href = ${JSON.stringify(second)}`),
    (s) => s.url === second && idle(s)
  );
  let killed: ProcessGoneEvent | undefined;
  const inPlace = await waitForLoad(
    h,
    async () => (killed = await kill(2)),
    (s) => s.url === second && idle(s) && s.canGoBack
  );
  r.check(
    'a second page reloads in place, canGoBack unchanged',
    killed?.recovered === true && inPlace,
    h.state()
  );
  h.ref.current?.goBack();
  r.check(
    'back after recovery goes to the page before it, with forward kept',
    await waitFor(h, (s) => s.url === page && idle(s) && s.canGoForward, 15000),
    h.state()
  );
  // Android attaches the hooks to the new WebView; iOS keeps the delegates: the sample's page counter still counts.
  r.check(
    'the hooks are attached after recovery',
    await waitFor(h, () => h.events.pageCounts.length > countsBefore, 5000),
    h.events.pageCounts.length - countsBefore
  );
  const recoveredVh = await viewportHeight(h);
  r.check('100vh has a height after recovery', recoveredVh > 0, recoveredVh);
  r.since(
    WEBVIEW.bridge,
    'the bridge works after recovery',
    (await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode)) === 4
  );
  // Android builds a new WebView on recovery: its settings must be applied again.
  r.check('the setting is still applied after recovery', !!(await userAgent()));

  // The recovery reload ends first: before WebView 146 the state reads idle before it starts, and it would cut off
  // the navigation below.
  await waitForLoad(h, () => kill(3));
  // The 4th kill cuts off a slow load: with no reload to end it, the core must. Before WebView 146 the load starts at
  // commit, after the delay, so the kill lands on the committed slow page instead.
  await until(
    async () =>
      (await h.ref.current?.evaluate('document.readyState').catch(errorCode)) === 'complete'
  );
  const slowStarts = h.events.loads.length;
  await h.ref.current
    ?.evaluate(`location.href = ${JSON.stringify(fresh(h, '/slow?ms=10000'))}`)
    .catch(errorCode); // the navigation it starts can end its document first
  await waitFor(h, () => h.events.loads.slice(slowStarts).includes('start'));
  const fourth = await kill(4);
  const onScreen = h.state().url; // the page on screen: the retry below brings it back
  // Only meaningful when all four crashes fell inside the 60 s window (slow reloads can stretch the test past it).
  const elapsed = Date.now() - firstKillAt;
  if (elapsed < 55000)
    r.check(
      'a crash loop stops reloading (4th crash in 60 s)',
      fourth?.recovered === false,
      fourth
    );
  else r.info('crash loop check skipped: the 4 crashes took', elapsed);
  r.check(
    'a crash during a load ends it (loading: false)',
    await waitFor(h, (s) => !s.loading, 5000),
    h.state()
  );
  // The action loads `url`, and the page itself agrees it is there.
  const brings = async (action: () => void, url: string) =>
    (await waitForLoad(h, action, (s) => s.url === url && idle(s))) &&
    (await h.ref.current?.evaluate('location.href').catch(errorCode)) === url;
  r.check(
    'reload() brings the page back after giving up',
    await brings(() => h.ref.current?.reload(), onScreen),
    h.state()
  );
  r.check(
    'loading a new source works after giving up',
    await openPage(h, fresh(h, '/')),
    h.state()
  );
  const loopAt = Date.now();
  r.check(
    'a crash after reload() and a new source recovers',
    (await kill(5))?.recovered === true,
    h.events.gone.at(-1)
  );
  // load() as reload() above: a crash loop again, then load() loads and starts the limit over.
  for (const n of [6, 7]) await waitForLoad(h, () => kill(n));
  const eighth = await kill(8);
  if (Date.now() - loopAt < 55000)
    r.check('a crash loop stops reloading again', eighth?.recovered === false, eighth);
  else r.info('second crash loop check skipped: the 4 crashes took', Date.now() - loopAt);
  const loaded = fresh(h, '/bridge.html');
  r.check(
    'load() loads after giving up',
    await brings(() => h.ref.current?.load(loaded), loaded),
    h.state()
  );
  r.check(
    'a crash after load() recovers: it starts the limit over',
    (await kill(9))?.recovered === true,
    h.events.gone.at(-1)
  );

  // An html source has no URL to fetch (the URL is its baseUrl): recovery loads the source again.
  h.loadSource({ html: '<p id="marker">html source</p>', baseUrl: h.pages });
  // An evaluate that the recovery's navigation rejects is expected while polling; its error code shows in the result.
  const marker = () =>
    h.ref.current
      ?.evaluate(`document.getElementById('marker')?.textContent ?? null`)
      .catch(errorCode);
  const shown = async () => !!(await until(async () => (await marker()) === 'html source'));
  r.check('an html source is shown', await shown(), await marker());
  r.check(
    'processGone reported and recovered (html source)',
    (await kill(10))?.recovered === true,
    h.events.gone.at(-1)
  );
  r.check('the html source is shown again after recovery', await shown(), await marker());

  // A POST source on screen isn't sent again unasked (a payment form): recovery stops, and reload() sends it.
  const post = fresh(h, '/post');
  const body = `amount=9.99&t=${Date.now()}`;
  await openPage(h, { uri: post, body }, 10000);
  const postGone = await kill(11);
  r.check('a POST source is not sent again on recovery', postGone?.recovered === false, postGone);
  await waitForLoad(h, () => h.ref.current?.reload());
  r.check(
    'reload() sends the POST source after a crash',
    (await text(h, 'body')) === body,
    h.state()
  );

  // A crash in the background reloads once the app is back: there the reload could die the same way, unseen. The
  // driver sends the app to the background, kills the renderer and brings the app back 5 s later.
  const away = fresh(h, '/bridge.html');
  await openPage(h, away);
  const states: { state: string; at: number }[] = [];
  const appState = AppState.addEventListener('change', (state) =>
    states.push({ state, at: Date.now() })
  );
  let backgroundGone: ProcessGoneEvent | undefined;
  const recovered = await waitForLoad(
    h,
    async () => (backgroundGone = await kill(12, 'BACKGROUND')),
    (s) => s.url === away && idle(s),
    30000
  );
  appState.remove();
  const activeAt = states.find((s) => s.state === 'active')?.at ?? Infinity;
  // The reloaded document's start, on the same clock as Date.now(). The reload may start shortly before JS sees
  // `active` (Android's window is visible before onResume).
  const loadedAt = await h.ref.current?.evaluate('performance.timeOrigin').catch(errorCode);
  r.check(
    'a crash in the background reloads once the app is active',
    backgroundGone?.recovered === true &&
      recovered &&
      typeof loadedAt === 'number' &&
      loadedAt > activeAt - 1500,
    {
      backgroundGone,
      recovered,
      states,
      loadedAt,
      startedBeforeActive: activeAt - Number(loadedAt),
    }
  );

  // A load() while the recovery waits (the app in the background) loads on top of the history, as without a crash:
  // back goes to the page on screen at the crash. The driver backgrounds the app around the kill as above.
  const asked = fresh(h, '/bridge.html');
  h.setProps({
    userAgent: 'Crash/1',
    onProcessGone: (event) => {
      h.events.gone.push(event);
      h.ref.current?.load(asked);
    },
  });
  const loadedOnTop = await waitForLoad(
    h,
    () => kill(13, 'BACKGROUND'),
    (s) => s.url === asked && idle(s),
    30000
  );
  h.ref.current?.goBack();
  r.check(
    'a load() while the recovery waits keeps the history',
    loadedOnTop && (await waitFor(h, (s) => s.url === away && idle(s), 15000)),
    h.state()
  );
  h.setProps({ userAgent: 'Crash/1' }); // the next kill's onProcessGone loads nothing

  // A crash while the view is out of its window (under a full-screen modal) reloads once it is back in one. Android
  // keeps the window of a view under a modal, so this is iOS's case.
  if (Platform.OS === 'ios') {
    const under = fresh(h, '/bridge.html');
    await openPage(h, under);
    h.setCovered(true);
    await sleep(1000); // the presentation
    const starts = h.events.loads.length;
    const coveredGone = await kill(14);
    await sleep(2000);
    const whileCovered = h.events.loads.slice(starts);
    const uncovered = await waitForLoad(
      h,
      () => h.setCovered(false),
      (s) => s.url === under && idle(s)
    );
    r.check(
      'a crash out of the window reloads once the view is back in one',
      coveredGone?.recovered === true && whileCovered.length === 0 && uncovered,
      { coveredGone, whileCovered, state: h.state() }
    );
  }
  r.done();
}

/**
 * alert, confirm and prompt reach the user and their answers reach the page, and an unmount completes the dialog on
 * screen. The driver presses OK.
 */
async function dialogs(h: Harness) {
  const r = reporter('dialogs');
  const alertUp = async () => {
    await openPage(h, fresh(h, '/dialogs.html'));
    void h.ref.current?.evaluate(`setTimeout(() => document.getElementById('alert').click(), 0)`);
    await sleep(1000); // the presentation
  };
  // The presses below answer in the remounted WebView.
  await alertUp();
  r.check(
    'an unmount while an alert is up completes it',
    await waitForLoad(h, () => h.remount()),
    h.state()
  );
  await openPage(h, fresh(h, '/dialogs.html'));
  for (const [id, expected] of [
    ['alert', 'alert closed'],
    ['confirm', 'confirm true'],
    ['prompt', 'prompt default'],
  ] as const) {
    const lines = await pageLog(
      h,
      () => {
        // Ask for the press first and do not await: on iOS evaluate does not return while a dialog blocks the page.
        r.info('PRESS', 'OK');
        void h.ref.current?.evaluate(
          `setTimeout(() => document.getElementById('${id}').click(), 0)`
        );
      },
      15000
    );
    r.check(`${id} answered with OK`, lines?.join() === expected, lines);
  }
  // UIKit runs a pressed button's handler only after the dismissal animation, so an unmount can come between the two.
  if (Platform.OS === 'ios') {
    await alertUp();
    const pressed = await seams.tapAlert('OK');
    const remounted = await waitForLoad(h, () => h.remount());
    await openPage(h, fresh(h, '/dialogs.html'));
    const lines = await pageLog(h, () => {
      void h.ref.current?.evaluate(
        `setTimeout(() => document.getElementById('confirm').click(), 0)`
      );
      setTimeout(() => void seams.tapAlert('OK'), 1000);
    });
    r.check(
      'an unmount right after OK is pressed completes the alert once',
      pressed && remounted && lines?.join() === 'confirm true',
      { pressed, remounted, lines }
    );
  }
  r.done();
}

/**
 * A creation-time setting changed while mounted recreates the WebView (iOS: an `ios.configuration` key; Android has
 * none, so a remount stands in); afterwards the page, the bridge, the extensions and `ask` must all still work.
 */
async function mountSettings(h: Harness) {
  const r = reporter('mountSettings');
  const uaOf = async () => {
    await openPage(h, fresh(h, '/ua'));
    return await text(h, 'ua');
  };
  const page = fresh(h, '/bridge.html');
  await openPage(h, page);
  await recreate(
    h,
    Platform.OS === 'ios'
      ? { ios: { configuration: { applicationNameForUserAgent: 'Remounted/9' } } }
      : {
          android: {
            settings: { userAgentString: `${AndroidWebView.defaultUserAgent} Remounted/9` },
          },
        },
    Platform.OS === 'android'
  );
  const remountedVh = await viewportHeight(h);
  r.check('100vh has a height after the recreation', remountedVh > 0, remountedVh);
  const ua = await uaOf();
  r.check(
    'a changed creation-time setting recreates the WebView and applies',
    ua.endsWith(' Remounted/9'),
    ua
  );
  await openPage(h, fresh(h, '/bridge.html'));
  r.since(
    WEBVIEW.bridge,
    'the bridge works after the remount',
    (await h.bridge.call('sum', { a: 3, b: 4 }).catch(errorCode)) === 7
  );
  const asked = await allowAsks(h, [{ path: ['/checkout'], action: 'ask' }]);
  await openPage(h, fresh(h, '/nav.html'));
  await click(h, 'checkout');
  const reached = await waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 8000);
  r.check('ask works after the remount', reached && asked.length > 0, { reached, asked });
  r.done();
}

/** `ios` / `android` settings by name: applied live, seen by the page, rejected with a warning when wrong; get and call. */
async function settings(h: Harness) {
  const r = reporter('settings');
  const { lines: warnings, warned, stop } = captureWarnings();
  const page = (expression: string) => h.ref.current?.evaluate(expression).catch(errorCode);
  const get = (key: string) => h.ref.current?.get(key).catch(errorCode);
  /** Whether `read` gives `want` within 3 s: a setting reaches the WebView, and the page, on their own schedule. */
  const becomes = async (read: () => Promise<unknown> | undefined, want: unknown) =>
    !!(await until(async () => (await read()) === want, 3000));
  // An 8px span's computed size: the minimum font size setting raises it.
  const fontSize = () =>
    page(`(() => {
      const s = document.createElement('span'); s.style.fontSize = '8px'; s.textContent = 'x'; document.body.append(s);
      const size = getComputedStyle(s).fontSize; s.remove(); return size;
    })()`);
  try {
    await openPage(h, fresh(h, '/'));
    if (Platform.OS === 'ios') {
      const configuration = { applicationNameForUserAgent: 'Settings/1' };
      const preferences = { minimumFontSize: 30 };
      await recreate(h, {
        ios: {
          configuration,
          preferences,
          scrollView: { other: { nope: 1 } },
        },
      });
      r.check('a WKPreferences number applies', (await fontSize()) === '30px', await fontSize());
      r.check(
        'an unknown property warns',
        warned('ios.scrollView.nope: no such property'),
        warnings
      );
      // The same configuration from here on, so this is the same WebView.
      h.setProps({ ios: { configuration, preferences: { minimumFontSize: 'big' as never } } });
      await sleep(500);
      r.check('and leaves the property alone', (await fontSize()) === '30px', await fontSize());
      await openPage(h, fresh(h, '/ptr.html?mode=long'));
      h.setProps({
        ios: {
          configuration,
          scrollView: {
            contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
            contentOffset: { x: 0, y: 30 },
          },
        },
      });
      r.check(
        'a UIScrollView struct applies',
        await becomes(() => page('scrollY'), 30),
        await page('scrollY')
      );
      // Removed by the update that set the offset, which has applied.
      r.check(
        'a removed key (preferences.minimumFontSize) goes back to its start-up value',
        (await get('preferences.minimumFontSize')) === 0
      );
      const width = (await page('innerWidth')) as number;
      h.setProps({ ios: { configuration, webView: { pageZoom: 2 } } });
      const zoomedIn = await until(
        async () => Math.abs(((await page('innerWidth')) as number) * 2 - width) <= 2,
        3000
      );
      r.check('a WKWebView number applies', !!zoomedIn, {
        width,
        zoomed: await page('innerWidth'),
      });
      h.setProps({
        ios: {
          configuration,
          webpagePreferences: { preferredContentMode: IOSConstants.ContentMode.desktop },
        },
      });
      await becomes(
        () => get('webpagePreferences.preferredContentMode'),
        IOSConstants.ContentMode.desktop
      );
      await openPage(h, fresh(h, '/'));
      const desktop = await page('navigator.userAgent');
      r.check(
        'a WKWebpagePreferences enum applies from the next navigation',
        String(desktop).includes('Macintosh'),
        desktop
      );
      h.setProps({
        ios: {
          configuration,
          scrollView: { bounces: false, contentInset: { top: 5, left: 0, bottom: 0, right: 0 } },
        },
      });
      // bounces starts out true; the inset comes in the same update.
      r.check('get reads a BOOL', await becomes(() => get('scrollView.bounces'), false));
      const inset = (await get('scrollView.contentInset')) as Record<string, number> | undefined;
      r.check(
        'get reads a struct',
        inset?.top === 5 && inset.left === 0 && inset.bottom === 0 && inset.right === 0,
        inset
      );
      r.check(
        'get reads a configuration property',
        (await get('configuration.applicationNameForUserAgent')) === 'Settings/1'
      );
      r.check(
        'get rejects for an unknown property',
        (await get('scrollView.nope')) === 'not_found'
      );
      const call = (method: string, args?: unknown[]) =>
        h.ref.current?.call(method, args).catch(errorCode);
      // The site data clear below removes this cookie.
      const value = String(Date.now());
      const setCookie = (cookie: Record<string, string>) =>
        call('httpCookieStore.setCookie:completionHandler:', [{ cookie }]);
      const stored = await setCookie({
        Name: 'mrwCall',
        Value: value,
        Domain: 'localhost',
        Path: '/',
      });
      const cookies = (await call('httpCookieStore.getAllCookies:')) as
        { Name: string; Value: string }[] | string | undefined;
      r.check(
        'call takes { cookie } and resolves an NSHTTPCookie as its properties',
        stored === null &&
          Array.isArray(cookies) &&
          cookies.some((c) => c.Name === 'mrwCall' && c.Value === value),
        { stored, cookies }
      );
      r.check(
        "call rejects a cookie that can't be made (no domain or path)",
        (await setCookie({ Name: 'mrwCall', Value: value })) === 'native_error'
      );
      await page(`(document.cookie = 'mrw=1; path=/')`);
      const before = await page('document.cookie');
      const cleared = await call(
        'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
        [{ set: [IOSConstants.WebsiteDataType.cookies] }, { date: 0 }]
      );
      r.check(
        'call clears site data (a void completion handler)',
        String(before).includes('mrw=1') &&
          cleared === null &&
          (await page('document.cookie')) === '',
        { before, cleared }
      );
      const pdf = await call('webView.createPDFWithConfiguration:completionHandler:', [null]);
      r.check(
        'call resolves NSData as base64',
        typeof pdf === 'string' && pdf.length > 100 && pdf.startsWith('JVBERi0'),
        String(pdf).slice(0, 20)
      );
      const png = await call('webView.takeSnapshotWithConfiguration:completionHandler:', [null]);
      r.check(
        'call resolves a UIImage as a PNG',
        typeof png === 'string' && png.startsWith('iVBORw0KGgo'),
        String(png).slice(0, 20)
      );
      const records = await call('websiteDataStore.fetchDataRecordsOfTypes:completionHandler:', [
        { set: [IOSConstants.WebsiteDataType.localStorage] },
      ]);
      r.check('call resolves a value completion handler', Array.isArray(records), records);
      const playback = await call('webView.requestMediaPlaybackStateWithCompletionHandler:');
      r.check(
        'call resolves an integer completion handler (no media: none)',
        playback === IOSConstants.MediaPlaybackState.none,
        playback
      );
      // iOS 18 selectors: below it the call rejects with not_found, so the checks are skipped.
      if (parseFloat(String(Platform.Version)) >= 18) {
        await page(`sessionStorage.setItem('mrw', '1')`);
        const session = await call('webView.fetchDataOfTypes:completionHandler:', [
          IOSConstants.WebViewDataType.sessionStorage,
        ]);
        const restored = await call('webView.restoreData:completionHandler:', [{ data: session }]);
        r.check(
          'call takes NSData and an error completion handler',
          typeof session === 'string' && session.length > 0 && restored === null,
          { session: String(session).slice(0, 12), restored }
        );
      } else r.info('call takes NSData: needs iOS 18', Platform.Version);
      r.check(
        'get reads a websiteDataStore property',
        (await get('websiteDataStore.persistent')) === true
      );
      await call('scrollView.setContentOffset:animated:', [{ x: 0, y: 30 }, false]);
      const offset = (await get('scrollView.contentOffset')) as { y: number } | undefined;
      r.check('call takes a struct and a BOOL', offset?.y === 30, offset);
      r.check(
        'call refuses a core-owned selector',
        (await call('webView.loadRequest:', [null])) === 'native_error'
      );
      r.check(
        'call refuses a private selector',
        (await call('webView._nope', [])) === 'native_error'
      );
      r.check(
        'call refuses init, and the WebView still works',
        (await call('webView.init', [])) === 'native_error' && (await page('1+1')) === 2
      );
      r.check(
        'call rejects a wrong argument count',
        (await call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }])) === 'native_error'
      );
      const transparent = await call('webView.setOpaque:', [false]);
      const opaque = await call('webView.isOpaque', []);
      r.check(
        'call makes the WebView transparent (setOpaque: false), and isOpaque reads back false',
        transparent === null && opaque === false,
        { transparent, opaque }
      );
    } else {
      const payment = () => page(`typeof PaymentRequest`);
      const paymentBefore = await payment();
      const fontBefore = await get('settings.minimumFontSize');
      h.setProps({
        android: {
          settings: { minimumFontSize: 30, paymentRequestEnabled: true },
          webView: { networkAvailable: false, other: { webViewClient: null } },
        },
      });
      r.check('a WebSettings setter applies', await becomes(fontSize, '30px'), await fontSize());
      r.check('a WebView setter applies', await becomes(() => page('navigator.onLine'), false));
      await openPage(h, fresh(h, '/'));
      const paymentAfter = await payment();
      r.since(
        WEBVIEW.paymentRequest,
        'a setter only WebSettingsCompat has applies (through reflection on androidx)',
        paymentBefore === 'undefined' && paymentAfter === 'function',
        { paymentBefore, paymentAfter }
      );
      r.check(
        'a core-owned setter warns',
        warned('android.webView.webViewClient: owned by the core'),
        warnings
      );
      // The renderer process keeps navigator.onLine for later WebViews: put it back.
      h.setProps({
        android: {
          settings: { minimumFontSize: 'big' as never, paymentRequestEnabled: true },
          webView: { networkAvailable: true },
        },
      });
      // The rejected minimumFontSize comes in the same update as networkAvailable.
      const restored = await becomes(() => page('navigator.onLine'), true);
      r.check('and leaves the setting alone', (await fontSize()) === '30px', await fontSize());
      r.check('networkAvailable is restored', restored);
      r.check('get reads a WebSettings getter', (await get('settings.minimumFontSize')) === 30);
      r.since(
        WEBVIEW.paymentRequest,
        'get reads a WebSettingsCompat getter',
        (await get('settings.paymentRequestEnabled')) === true
      );
      r.check('get reads an is-getter', (await get('webView.verticalScrollBarEnabled')) === true);
      r.check('get rejects for an unknown key', (await get('settings.nope')) === 'not_found');
      const call = (method: string, args?: unknown[]) =>
        h.ref.current?.call(method, args).catch(errorCode);
      r.check('call runs a WebView method', (await call('webView.clearCache', [true])) === null);
      r.check('call returns the result', (await call('webView.getTitle')) === 'Test pages');
      r.check(
        'call rejects for a core-owned method',
        (await call('webView.destroy')) === 'native_error'
      );
      const origin = String(await page('location.origin'));
      const set = await call('cookieManager.setCookie', [origin, 'mrwSet=2']);
      const read = await call('cookieManager.getCookie', [origin]);
      r.check(
        'call sets and reads a cookie through cookieManager',
        set === null && String(read).includes('mrwSet=2'),
        { set, read }
      );
      await page(`(document.cookie = 'mrw=1; path=/')`);
      const before = await page('document.cookie');
      // No callback in the args: the call resolves once the cookies are gone, with whether there were any.
      const removed = await call('cookieManager.removeAllCookies');
      r.check(
        'call awaits a ValueCallback: cookieManager.removeAllCookies',
        String(before).includes('mrw=1') &&
          removed === true &&
          (await page('document.cookie')) === '',
        { before, removed }
      );
      r.check('call reaches webStorage', (await call('webStorage.deleteAllData')) === null);
      // WebView has no getter for it: the check is that it applies.
      h.setProps({ android: { webView: { other: { backgroundColor: 0 } } } });
      await sleep(500);
      r.check(
        'android.webView.backgroundColor 0 (transparent) applies without a warning',
        !warned('android.webView.backgroundColor'),
        warnings
      );
      r.check(
        'a removed key (settings.minimumFontSize) goes back to its start-up value',
        (await get('settings.minimumFontSize')) === fontBefore,
        { fontBefore }
      );
    }
  } finally {
    stop();
  }
  r.done();
}

/** Rules, new windows, external links handed to JS, iframes, intent fallbacks and the ask redirect-loop guard. */
async function navigation(h: Harness) {
  const r = reporter('navigation');
  const external: string[] = [];
  const asked: string[] = [];
  let lastAskAt = 0;
  const lastNavigation = () => h.events.navigations[h.events.navigations.length - 1];
  h.setProps({
    onOpenExternal: recordExternal(external),
  });
  h.setAsk((request) => {
    asked.push(request.url);
    lastAskAt = Date.now();
    return 'allow';
  });
  h.setRules([
    { scheme: ['tel', 'mailto', 'sms'], action: 'external' },
    { host: ['localhost'], path: ['/checkout'], action: 'ask' },
    { host: ['localhost'], newWindow: true, path: ['/spa'], action: 'allow' },
    { newWindow: true, action: 'external' },
    { host: ['localhost', '127.0.0.1'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
    { scheme: ['http', 'https'], action: 'external' },
  ]);
  await sleep(500);
  const page = fresh(h, '/nav.html');
  await openPage(h, page);
  h.events.navigations.length = 0;
  /** A main-frame navigation that doesn't load in place: no load start after `act`, and `outcome` is unchanged. */
  const noLoad = async (name: string, act: () => Promise<unknown>) => {
    const [loads, outcome] = [h.events.loads.length, h.state().outcome];
    await act();
    await sleep(500);
    const added = h.events.loads.slice(loads);
    r.check(`${name} reports no load`, !added.includes('start') && h.state().outcome === outcome, {
      added,
      outcome: h.state().outcome,
      was: outcome,
    });
  };

  await noLoad('a tapped tel: link', async () => {
    await click(h, 'tel');
    await waitFor(h, () => lastNavigation() !== undefined, 3000);
  });
  r.check('tel: goes to onOpenExternal', external[0] === 'tel:+3725551234', external);
  r.check(
    'onNavigation reports the external decision and rule',
    lastNavigation()?.action === 'external' && lastNavigation()?.rule === 0,
    lastNavigation()
  );
  r.check('the page stays', h.state().url === page, h.state());

  await noLoad('an external link', async () => {
    await click(h, 'external');
    await waitFor(h, () => external.length > 1, 3000);
  });
  r.check(
    'an outside main-frame link goes external',
    external[1] === 'https://example.com/',
    external
  );

  // Script-opened windows are off by default, so new windows come from a tap.
  await tap(h, r, 'open');
  await waitFor(h, () => lastNavigation()?.url === 'https://example.com/popup', 15000);
  r.check(
    'a tapped window.open to another site goes external (newWindow)',
    external[2] === 'https://example.com/popup',
    external
  );
  r.check(
    'onNavigation marks it as a new window',
    lastNavigation()?.newWindow === true,
    lastNavigation()
  );

  await tap(h, r, 'blank');
  const inPlace = await waitFor(h, (s) => s.url.endsWith('/spa.html') && idle(s), 15000);
  r.check('a tapped target=_blank allowed by a newWindow rule loads in place', inPlace, h.state());

  const selfOpening = (name: string) => ({
    html: `<script>setTimeout(() => { window.open('https://example.com/${name}'); window.__opened = true; }, 300)</script>`,
    baseUrl: h.pages,
  });
  h.loadSource(selfOpening('blocked'));
  // A window it wrongly opened would reach onOpenExternal right after the page's try.
  await until(
    async () => (await h.ref.current?.evaluate('window.__opened').catch(errorCode)) === true,
    5000
  );
  await sleep(1000);
  r.check(
    'by default a script cannot open a window without a gesture',
    !external.includes('https://example.com/blocked'),
    external
  );
  h.setProps({
    onOpenExternal: recordExternal(external),
    ios: { preferences: { javaScriptCanOpenWindowsAutomatically: true } },
    android: { settings: { javaScriptCanOpenWindowsAutomatically: true } },
  });
  const optIn = `${Platform.OS === 'ios' ? 'preferences' : 'settings'}.javaScriptCanOpenWindowsAutomatically`;
  await until(async () => (await h.ref.current?.get(optIn).catch(errorCode)) === true, 3000);
  h.loadSource(selfOpening('opted-in'));
  await waitFor(h, () => external.includes('https://example.com/opted-in'), 5000);
  r.check(
    'javaScriptCanOpenWindowsAutomatically lets it, through the newWindow rules',
    external.includes('https://example.com/opted-in'),
    external
  );
  await openPage(h, fresh(h, '/nav.html'));
  if (Platform.OS === 'ios') {
    await click(h, 'redirect', 'frame')?.catch(errorCode);
    // Decisions about the iframe's navigation come before it moves (its redirect ends on /spa.html?from=redirect).
    const frameUrl = () =>
      h.ref.current?.evaluate(`document.getElementById('frame').contentWindow.location.href`);
    await until(
      async () => String(await frameUrl()?.catch(errorCode)).includes('from=redirect'),
      5000
    );
    await until(() => h.events.navigations.some((n) => !n.mainFrame && n.action === 'allow'), 3000);
    const frames = h.events.navigations.filter((n) => !n.mainFrame);
    r.check(
      'iframe navigations are decided as mainFrame false',
      frames.some((n) => n.action === 'allow'),
      frames.slice(0, 3)
    );
  }

  asked.length = 0;
  await h.ref.current?.evaluate(`location.href = '/checkout/loopA'`);
  // Over once the loop's navigation has ended with no ask for a second; a third ask fails it at once.
  await until(
    () =>
      asked.length > 2 || (asked.length > 0 && idle(h.state()) && Date.now() - lastAskAt > 1000),
    10000
  );
  r.check(
    'an ask redirect loop asks at most once per URL',
    asked.length >= 1 && asked.length <= 2,
    asked
  );
  await openPage(h, fresh(h, '/nav.html'));

  // An `ask` may answer `external`; any other answer (here one untyped JS could give) blocks.
  const askedPage = h.state().url;
  const decided = (path: string) =>
    waitFor(h, () => lastNavigation()?.url.endsWith(path) === true, 3000);
  h.setAsk(() => 'external');
  await noLoad('an ask answered external', async () => {
    await h.ref.current?.evaluate(`location.href = '/checkout/external'`);
    await decided('/checkout/external');
  });
  r.check(
    'an ask answered external goes to onOpenExternal',
    lastNavigation()?.action === 'external' &&
      external.some((url) => url.endsWith('/checkout/external')),
    { navigation: lastNavigation(), external }
  );
  h.setAsk(() => 'deny' as unknown as 'block');
  await noLoad('a blocked location.href', async () => {
    await h.ref.current?.evaluate(`location.href = '/checkout/invalid'`);
    await decided('/checkout/invalid');
  });
  r.check('an invalid ask answer blocks', lastNavigation()?.action === 'block', lastNavigation());
  r.check('the page stays after both', h.state().url === askedPage, h.state());

  h.setProps({});
  h.setRules([{ scheme: ['nosuchapp'], action: 'external' }]);
  await sleep(500);
  await h.ref.current?.evaluate(`location.href = 'nosuchapp://x'`);
  await waitFor(h, () => lastNavigation()?.url === 'nosuchapp://x', 5000);
  r.check(
    'an external URL nothing opens is reported as block',
    lastNavigation()?.action === 'block',
    lastNavigation()
  );

  // The core opens what onOpenExternal hands back (false) as it does without the prop. Android: an intent: for an app
  // that isn't installed, whose fallback goes through the rules. iOS: a tel:, which a simulator has no app for.
  h.setRules([
    { scheme: ['intent', 'tel'], action: 'external' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  const scheme = Platform.OS === 'android' ? 'intent:' : 'tel:';
  const sendExternal = async (from: string, onOpenExternal?: WebViewProps['onOpenExternal']) => {
    h.setProps(onOpenExternal ? { onOpenExternal } : {});
    await sleep(500);
    external.length = 0;
    h.events.navigations.length = 0;
    const fallback = `${h.pages}/spa.html?from=${from}`;
    const url =
      Platform.OS === 'android'
        ? `intent://nothing/#Intent;scheme=nothere;package=com.example.notinstalled;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
        : 'tel:+3725551234';
    await h.ref.current?.evaluate(`location.href = ${JSON.stringify(url)}`);
    const decided = (prefix: string) => h.events.navigations.find((n) => n.url.startsWith(prefix));
    await waitFor(h, () => decided(scheme) !== undefined, 5000);
    // The core decides the fallback before it reports the intent:, so only a decided one gets time to load.
    const loaded = await waitFor(
      h,
      (s) => s.url === fallback && idle(s),
      decided(fallback) ? 8000 : 1000
    );
    return {
      external: [...external],
      decision: decided(scheme),
      fallback: decided(fallback),
      loaded,
    };
  };
  if (Platform.OS === 'android') {
    const own = await sendExternal('fallback');
    r.check('intent: without an app loads browser_fallback_url', own.loaded, own);
    r.check('the intent: itself is reported as block', own.decision?.action === 'block', own);
  }
  const handedBack = await sendExternal('handed-back', ({ url }) => {
    external.push(url);
    return false;
  });
  r.check(
    Platform.OS === 'android'
      ? 'onOpenExternal returning false hands an intent: back: its fallback loads through the rules, it is reported block'
      : 'onOpenExternal returning false hands tel: back to the OS, which opens nothing on a simulator: block',
    handedBack.external.length === 1 &&
      handedBack.decision?.action === 'block' &&
      (Platform.OS === 'ios' || (handedBack.loaded && handedBack.fallback?.rule === 1)),
    handedBack
  );
  const handled = await sendExternal('handled', ({ url }) => {
    external.push(url);
    return true;
  });
  r.check(
    'onOpenExternal returning true has opened it: reported external, no fallback',
    handled.external.length === 1 &&
      handled.decision?.action === 'external' &&
      handled.fallback === undefined &&
      !handled.loaded,
    handled
  );
  r.done();
}

/**
 * The `injectedScripts` prop: when its scripts run, in which frames and on which origins, and that a change applies
 * from the next load.
 */
async function injection(h: Harness) {
  const r = reporter('injection', WEBVIEW.injectedScripts);
  h.setProps({
    injectedScripts: [
      {
        code: 'window.__injectedStart = true;\nfunction __globalFn() {}',
        allFrames: true,
        origins: ['*'],
      },
      { code: 'window.__mainOnly = true; window.__marker = "one";', origins: ['*'] },
      {
        code: `addEventListener('DOMContentLoaded', () => (window.__injectedEnd = !!document.getElementById('end')));`,
        origins: ['*'],
      },
      {
        code: 'window.__scoped = true;\nfunction __scopedFn() {}',
        allFrames: true,
        origins: [h.pages],
      },
      { code: 'window.__elsewhere = true;', allFrames: true, origins: ['https://example.com'] },
    ],
  });
  await sleep(500);
  await openPage(h, fresh(h, '/injection.html'));
  await until(async () => (await text(h, 'end')) !== '', 3000); // the page's load listener fills it
  r.check('a script runs before page scripts', (await text(h, 'start')) === 'true');
  r.check(
    'its DOMContentLoaded listener runs once the DOM is parsed',
    (await text(h, 'end')) === 'true'
  );
  const frame = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return { start: w.__injectedStart === true, mainOnly: w.__mainOnly === true, top: window.__mainOnly === true };
  })()`)) as { start: boolean; mainOnly: boolean; top: boolean };
  r.check('an allFrames script runs in iframes', frame.start, frame);
  r.check('a script runs in the main frame only by default', frame.top && !frame.mainOnly, frame);
  const scoped = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return {
      main: window.__scoped === true, frame: w.__scoped === true, elsewhere: window.__elsewhere === true || w.__elsewhere === true,
      scopedFn: typeof __scopedFn, globalFn: typeof __globalFn,
    };
  })()`)) as Record<string, unknown>;
  r.check(
    'a scoped script runs on its origins only, main frame and iframes',
    scoped['main'] === true && scoped['frame'] === true && scoped['elsewhere'] === false,
    scoped
  );
  r.check(
    "a scoped script's declarations stay local; with '*' they are global",
    scoped['scopedFn'] === 'undefined' && scoped['globalFn'] === 'function',
    scoped
  );
  h.setProps({ injectedScripts: [{ code: 'window.__marker = "two";', origins: ['*'] }] });
  await sleep(500);
  r.check(
    'a changed script waits for the next navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'one'
  );
  await openPage(h, fresh(h, '/injection.html'));
  r.check(
    'the changed script applies after navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'two'
  );
  r.check('the removed script is gone', (await text(h, 'start')) === 'false');
  r.check(
    'the bridge page client still installs',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'object'
  );
  r.done();
}

/** Adds a download link to a blob of `bytes` zero bytes. */
const blobLink = (h: Harness, id: string, bytes: number) =>
  h.ref.current?.evaluate(
    `(() => { const a = document.createElement('a'); a.id = '${id}'; a.download = '${id}.bin'; a.href = URL.createObjectURL(new Blob([new Uint8Array(${bytes})])); document.body.append(a); })()`
  );

/**
 * Downloads: an attachment, a blob: and a data: link all end in onDownload with a cache file and a sanitised filename;
 * on Android a blob above the size cap fails, and an invalid data: link leaves the app running.
 */
async function downloadsSuite(h: Harness) {
  const r = reporter('downloads');
  await openPage(h, fresh(h, '/media.html'));
  await h.ref.current?.evaluate("document.cookie = 'dl=1'");
  // A long query: the event's `url` is the full server URL, never cut.
  const attachmentUrl = await h.ref.current?.evaluate(
    "(() => { const a = document.getElementById('attachment'); a.href += '&pad=' + 'x'.repeat(200); return a.href; })()"
  );
  for (const [id, filename, body] of [
    ['attachment', 'report.txt', 'downloaded report.txt'],
    ['blob', 'blob.txt', 'blob body'],
    ['data', 'data.txt', 'data body'],
    // Android fetches it again and the server then redirects to another host; iOS keeps WebKit's first response.
    ['moved', 'moved.txt', Platform.OS === 'android' ? 'downloaded moved.txt' : 'first response'],
  ] as const) {
    const [before, outcomes] = [h.events.downloads.length, h.events.outcomes.length];
    await click(h, id);
    const done = await waitFor(h, () => h.events.downloads.length > before, 20000);
    const download = h.events.downloads[before];
    if (id === 'attachment') {
      await waitFor(h, () => h.events.outcomes.length > outcomes, 2000);
      r.since(
        WEBVIEW.navigationListener,
        'the attachment load ends as cancelled',
        h.events.outcomes.length === outcomes + 1 && h.events.outcomes[outcomes] === 'cancelled',
        h.events.outcomes.slice(outcomes)
      );
    }
    const nameOk =
      Platform.OS === 'android' && (id === 'blob' || id === 'data')
        ? download?.filename.endsWith('.txt')
        : download?.filename === filename;
    // Android reads a blob: download through the page (evaluate).
    const floor = id === 'blob' ? WEBVIEW.evaluate : 0;
    r.since(floor, `${id} download reaches onDownload`, done && nameOk === true, download);
    const text = download?.uri.startsWith('file:') ? await new File(download.uri).text() : null;
    r.since(
      floor,
      `${id} file holds the body`,
      text?.startsWith(body) === true,
      text?.slice(0, 80)
    );
    if (id === 'attachment')
      r.check(
        'the attachment request carries the page cookie',
        text?.includes('dl=1') === true,
        text
      );
    const url =
      id === 'attachment'
        ? attachmentUrl
        : id === 'moved'
          ? await h.ref.current?.evaluate("document.getElementById('moved').href")
          : null;
    r.since(
      floor,
      `${id} download url is ${url === null ? 'null' : 'the full server URL'}`,
      download?.url === url,
      download?.url
    );
  }

  if (Platform.OS === 'android') {
    // Above Android's 100 MB cap a blob: download fails before the page reads it. The blobs are made only here.
    const failures = h.events.downloadFailures.length;
    await blobLink(h, 'bigblob', 101 * 1024 * 1024);
    await click(h, 'bigblob');
    const failed = await waitFor(h, () => h.events.downloadFailures.length > failures, 20000);
    const failure = h.events.downloadFailures[failures];
    r.check(
      'a blob above the size cap reports a data failure with a description',
      failed && failure?.kind === 'data' && failure.description.includes('larger than'),
      failure
    );
    // Far more than one reply can carry: the page reads it in chunks.
    const big = h.events.downloads.length;
    await blobLink(h, 'bigok', 40 * 1024 * 1024);
    await click(h, 'bigok');
    const saved = await waitFor(h, () => h.events.downloads.length > big, 30000);
    const bigFile = saved ? new File(h.events.downloads[big].uri) : null;
    r.since(
      WEBVIEW.evaluate,
      'a 40 MiB blob downloads whole',
      bigFile?.size === 40 * 1024 * 1024,
      h.events.downloads[big]
    );
    bigFile?.delete();
  }

  const opened: string[] = [];
  h.setProps({
    onDownload: undefined,
    onOpenExternal: recordExternal(opened),
  });
  await sleep(300);
  const events = () => h.events.downloads.length + h.events.downloadFailures.length;
  const before = events();
  const page = h.state().url;
  await click(h, 'attachment');
  await waitFor(h, () => opened.length > 0);
  r.check(
    'without onDownload an http download goes to onOpenExternal',
    opened[0] === attachmentUrl,
    opened
  );
  await click(h, 'blob');
  await click(h, 'data');
  await sleep(1500);
  r.check(
    'without onDownload data: and blob: are dropped (no event, no navigation)',
    events() === before && opened.length === 1 && h.state().url === page,
    { events: events() - before, opened, url: h.state().url }
  );
  const downloads = h.events.downloads.length;
  h.setProps({});
  await sleep(300);
  await click(h, 'data');
  r.check(
    'onDownload set again takes over without a remount',
    (await waitFor(h, () => h.events.downloads.length > downloads, 10000)) && opened.length === 1
  );

  if (Platform.OS === 'android') {
    await openPage(h, fresh(h, '/media.html'));
    const before = h.events.downloadFailures.length;
    await click(h, 'baddata');
    // Chromium may reject a malformed data: URL before the download listener runs; either way the app survives.
    // The listener runs right after the click when it runs at all.
    await waitFor(h, () => h.events.downloadFailures.length > before, 1500);
    r.info('invalid data: download failures reported', h.events.downloadFailures.slice(before));
    r.check(
      'the app survives an invalid data: download',
      (await h.ref.current?.evaluate('1 + 1')) === 2
    );
  }
  r.done();
}

/** Camera and location reach the page only when onPermissionRequest says yes, main frame only; the OS allows it here. */
async function permissionsSuite(h: Harness) {
  const r = reporter('permissions');
  const asked: PermissionRequest[] = [];
  let answer = false;
  let hold = false;
  const { stuck, never } = stuckHandler<boolean>();
  h.setPermission(async (request, signal) => {
    asked.push(request);
    return hold ? await never(signal) : answer;
  });
  const press = async (id: string) => (await pageLog(h, () => click(h, id)))?.join() ?? 'no result';
  await openPage(h, fresh(h, '/device.html'));
  answer = false;
  const denied = await press('camera');
  r.check('the app saying no denies the camera', denied.includes('NotAllowedError'), denied);
  r.check(
    'the request names origin and resource',
    asked[0]?.origin === h.pages && asked[0].resources.includes('camera'),
    asked[0]
  );

  answer = true;
  const granted = await press('camera');
  r.info('camera with app yes and OS permission', granted);
  if (Platform.OS === 'android') {
    r.check('app yes + OS permission grants the camera', granted.includes('camera ok'), granted);
    const geo = await press('geo');
    // Granted means anything but PERMISSION_DENIED (1): the emulator may have no fix yet (3, timeout).
    r.check(
      'location granted with app yes + OS permission',
      /geo ok|geo error [23]/.test(geo),
      geo
    );
    await openPage(h, fresh(h, '/device.html'));
    answer = false;
    const geoDenied = await press('geo');
    r.check(
      'location denied when the app says no (PERMISSION_DENIED)',
      geoDenied.includes('geo error 1'),
      geoDenied
    );
  }

  // Another origin's frame and a sandboxed one (an opaque origin), though the iframe allows the camera: denied without
  // asking.
  let askedBefore = asked.length;
  for (const [name, frame] of [
    [
      'a cross-origin frame',
      `{ allow: 'camera', src: 'http://127.0.0.1:8090/device.html?auto=camera' }`,
    ],
    // `camera *`: plain `camera` allows only the src's origin, so the page itself would refuse an opaque one.
    [
      'a sandboxed frame',
      `{ allow: 'camera *', sandbox: 'allow-scripts', src: '/device.html?auto=camera' }`,
    ],
  ]) {
    await openPage(h, fresh(h, '/device.html'));
    answer = true;
    askedBefore = asked.length;
    const framed =
      (
        await pageLog(h, () =>
          h.ref.current?.evaluate(
            `document.body.append(Object.assign(document.createElement('iframe'), ${frame}))`
          )
        )
      )?.join() ?? '';
    r.check(
      `${name} is denied without asking`,
      framed.includes('frame camera error') && asked.length === askedBefore,
      {
        framed,
        asked: asked.length - askedBefore,
      }
    );
  }

  // A handler that never settles: the next page cancels its request (deny), aborts its signal and asks the app again.
  await openPage(h, fresh(h, '/device.html'));
  hold = true;
  askedBefore = asked.length;
  await click(h, 'camera');
  await until(() => asked.length > askedBefore, 10000, 200);
  r.check(
    'a request whose handler never settles reaches JS',
    asked.length === askedBefore + 1,
    asked.length - askedBefore
  );
  hold = false;
  const navigatedAt = Date.now();
  await openPage(h, fresh(h, '/device.html'));
  await until(() => stuck.abortedAt, 2000);
  r.check(
    "navigating away aborts the held handler's signal within 2 s",
    stuck.abortedAt > 0 && stuck.abortedAt - navigatedAt < 2000,
    stuck.abortedAt ? stuck.abortedAt - navigatedAt : 'not aborted'
  );
  answer = false;
  const again = await press('camera');
  r.check(
    'after navigating, the page asks again and gets the answer',
    asked.length === askedBefore + 2 && again.includes('NotAllowedError'),
    { asked: asked.length - askedBefore, again }
  );
  stuck.release(true);
  await sleep(300);
  r.check(
    'a late answer for the replaced page changes nothing',
    (await h.ref.current?.evaluate('1 + 1')) === 2
  );
  answer = true;

  if (Platform.OS === 'android') {
    h.setProps({ onPermissionRequest: undefined });
    await sleep(300);
    askedBefore = asked.length;
    const unhandled = await press('camera');
    r.check(
      'without onPermissionRequest the camera is denied',
      unhandled.includes('NotAllowedError') && asked.length === askedBefore,
      unhandled
    );
    h.setProps({});
    await sleep(300);
    const restored = await press('camera');
    r.check(
      'onPermissionRequest set again takes over without a remount',
      restored.includes('camera ok') && asked.length > askedBefore,
      restored
    );
  }
  r.done();
}

/**
 * Android fullscreen: the page's fullscreen view shows, back leaves it. iOS: an unmount while a video is in fullscreen.
 * The driver taps and presses back.
 */
async function fullscreen(h: Harness) {
  const r = reporter('fullscreen');
  if (Platform.OS !== 'android') {
    // WebKit shows the video fullscreen itself, as an iPhone plays no video inline by default.
    await openPage(h, fresh(h, '/media.html'));
    const lines = await pageLog(h, async () => r.info('TAP', await tapPoint(h, 'play')));
    await sleep(1000); // the presentation
    const remounted = await waitForLoad(h, () => h.remount());
    r.check(
      'an unmount while a video is in fullscreen leaves the app running',
      lines?.includes('video fullscreen') === true && remounted,
      { lines, remounted }
    );
    r.done();
    return;
  }
  await openPage(h, fresh(h, '/media.html'));
  h.events.fullscreen.length = 0;
  r.info('TAP', await tapPoint(h, 'fullscreen'));
  r.check(
    'entering fullscreen is reported',
    await waitFor(h, () => h.events.fullscreen.includes(true), 10000),
    h.events.fullscreen
  );
  // BACK on the root screen would background the app: only send it when fullscreen is on.
  if (!h.events.fullscreen.includes(true)) {
    r.done();
    return;
  }
  r.info('BACK', 'leave');
  r.check(
    'back leaves fullscreen',
    await waitFor(h, () => h.events.fullscreen.at(-1) === false, 10000),
    h.events.fullscreen
  );
  r.check('the page is still there', h.state().url.includes('/media.html'), h.state());

  // Fullscreen works without onFullscreenChange too. Nothing is reported then, so the page's fullscreenElement tells.
  h.setProps({ onFullscreenChange: undefined });
  await sleep(300);
  const active = async () =>
    (await h.ref.current?.evaluate('document.fullscreenElement !== null')) === true;
  const becomes = async (want: boolean) => !!(await until(async () => (await active()) === want));
  const lines = await pageLog(h, async () => r.info('TAP', await tapPoint(h, 'fullscreen')));
  const entered = await becomes(true);
  r.check('fullscreen works without onFullscreenChange', entered, lines);
  if (entered) {
    r.info('BACK', 'leave');
    r.check('back leaves it', await becomes(false));
  }

  // A renderer crash ends the Document: the fullscreen view, the back handler and the hidden bars go without
  // Chromium's onHideCustomView, which a dead renderer never sends. Last, because recovery replaces the WebView.
  h.setProps({});
  await sleep(300);
  r.info('TAP', await tapPoint(h, 'fullscreen'));
  await waitFor(h, () => h.events.fullscreen.at(-1) === true, 10000);
  // The kill in fullscreen, then the recovery load.
  await waitForLoad(
    h,
    async () => {
      const gone = h.events.gone.length;
      r.info('KILL', 'in fullscreen');
      await waitFor(h, () => h.events.gone.length > gone, 15000);
      r.check(
        'a crash leaves fullscreen',
        await waitFor(h, () => h.events.fullscreen.at(-1) === false, 5000),
        h.events.fullscreen
      );
    },
    (s) => s.url.includes('/media.html') && idle(s)
  );
  r.done();
}

/** The out-of-package extension (example/modules/sample-extension) works through the public interface only. */
async function sampleExtension(h: Harness) {
  const r = reporter('sampleExtension');
  const mountEnds = h.events.documentEnds.length;
  await recreate(h, {}, true);
  const phantom = h.events.documentEnds.slice(mountEnds).filter((end) => end.url === '');
  r.check('the first commit after mount ends no Document', phantom.length === 0, phantom);
  // WebKit moves its back-forward list to the next page a moment before it reports the commit, so what a handler sees
  // can depend on timing: several same-origin navigations of each kind, each ending the page before it.
  const misses: unknown[] = [];
  const ends = async (go: () => unknown, to: string) => {
    const [from, count] = [h.state().url, h.events.documentEnds.length];
    await go();
    await waitFor(h, (s) => s.url === to && idle(s) && h.events.documentEnds.length > count, 5000);
    const end = h.events.documentEnds.at(-1);
    if (end?.reason !== 'committed' || end.url !== from) misses.push({ from, end });
  };
  for (let i = 0; i < 3; i++) {
    const [load, own] = [fresh(h, `/spa.html?load=${i}`), fresh(h, `/spa.html?own=${i}`)];
    await ends(() => h.load(load), load);
    await ends(
      () => h.ref.current?.evaluate(`(location.href = '${own}', 1)`).catch(errorCode),
      own
    );
    await ends(() => h.ref.current?.evaluate('(history.back(), 1)').catch(errorCode), load);
  }
  r.check(
    'its onDocumentEnd handler hears each page end as that page: app loads, page navigations, history.back',
    misses.length === 0,
    misses
  );
  const before = h.events.pageCounts.length;
  h.events.hookEvents.length = 0;
  const previous = h.state().url;
  const page = fresh(h, '/spa.html');
  await openPage(h, page);
  await waitFor(h, () => h.events.pageCounts.at(-1)?.url === page, 5000);
  const event = h.events.pageCounts.at(-1);
  r.check(
    'its delegate gets a callback the core implements too, and emits through onEvent',
    h.events.pageCounts.length > before && event?.url === page,
    event
  );
  const inPage = (await h.ref.current?.evaluate('window.__pageCount')) as number;
  r.check('its native side reaches the page', inPage === event?.count, { inPage, event });
  const ended = h.events.documentEnds.at(-1);
  r.check(
    'its onDocumentEnd handler hears the old page end, and context.url there is still that page',
    ended?.reason === 'committed' && ended.url === previous,
    { ended, previous }
  );
  const count = await h.ref.current?.hook('sample.pageCounter', 'count').catch(errorCode);
  r.check('ref.hook resolves with the reply of its handler', count === inPage, { count, inPage });
  const label = await h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  r.check(
    "its ask waits for the app's answer (onEvent's return value)",
    label === `page ${inPage}`,
    { label, inPage }
  );
  const unhandled = [
    await h.ref.current?.hook('sample.pageCounter', 'nope').catch(errorCode),
    await h.ref.current?.hook('noSuchHook', 'count').catch(errorCode),
  ];
  r.check(
    'ref.hook rejects with not_found when no attached hook handles the method',
    unhandled.every((code) => code === 'not_found'),
    unhandled
  );
  // A changed value reaches the attached hook (onOptions), which stamps the page under the new name.
  const url = h.state().url;
  const loads = h.events.loads.length;
  await h.ref.current?.evaluate('window.__kept = true');
  h.setProps({ extensions: [pageCounter({ global: '__liveCount' })], withoutPageCounter: true });
  const live = await until(
    async () => (await h.ref.current?.evaluate('window.__liveCount')) === inPage,
    3000
  );
  const kept = await h.ref.current?.evaluate('window.__kept');
  r.check(
    'an options change reaches its hook live, without recreating the WebView or reloading the page',
    !!live && kept === true && h.state().url === url && h.events.loads.length === loads,
    { live, kept, url: h.state().url, newLoads: h.events.loads.length - loads }
  );
  // Without onEvent the hook's `label` ask is answered null, and its handler fails the call.
  const failed = await h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  r.check('reply.fail rejects ref.hook with handler_error', failed === 'handler_error', failed);
  h.setProps({});
  if (Platform.OS === 'ios') {
    h.load(`${h.pages}/redirect?to=${encodeURIComponent('/spa.html?from=hook')}`);
    await waitFor(h, (s) => s.url.includes('from=hook') && idle(s));
    r.check(
      'a callback the core does not implement is forwarded to its delegate (didReceiveServerRedirect)',
      await waitFor(h, () => h.events.hookEvents.includes('sample.pageCounter.redirect'), 3000),
      h.events.hookEvents
    );
  } else {
    r.check(
      'a callback the core does not implement is forwarded to its client (onPageCommitVisible)',
      await waitFor(
        h,
        () => h.events.hookEvents.includes('sample.pageCounter.commitVisible'),
        3000
      ),
      h.events.hookEvents
    );
  }
  // A handler that hasn't replied when the WebView unmounts: its ask (`label`) is never answered.
  h.setProps({
    extensions: [pageCounter(true, () => new Promise<never>(() => {}))],
    withoutPageCounter: true,
  });
  await sleep(100);
  const held = h.ref.current?.hook('sample.pageCounter', 'label').catch(errorCode);
  await sleep(200);
  await recreate(h, {}, true);
  const unmounted = await Promise.race([held, sleep(3000).then(() => 'still pending')]);
  r.check(
    'unmount rejects a ref.hook in flight with navigated',
    unmounted === 'navigated',
    unmounted
  );
  // HTTP auth, which the core declines: the hook's delegate (client) answers it. Its key turns on after creation, and a
  // hook without configure attaches then.
  await recreate(h, {}, true);
  h.setProps({ extensions: [sampleHook('hookAuth')] });
  await openPage(h, fresh(h, '/auth?hook=1'));
  const auth = await text(h, 'auth');
  r.check(
    'a key turned on after creation attaches its hook: its delegate answers HTTP auth',
    auth === 'authorized',
    auth
  );
  // A hook with configure can't attach to a WebView that exists: its key turned on late warns and attaches nothing.
  await recreate(h, { extensions: [sampleHook('hookAuth')], withoutPageCounter: true }, true);
  const warnings = captureWarnings();
  try {
    h.setProps({ extensions: [sampleHook('hookAuth'), pageCounter()], withoutPageCounter: true });
    await until(() => warnings.warned('extension sample.pageCounter'), 3000, 100);
  } finally {
    warnings.stop();
  }
  const late = await h.ref.current?.hook('sample.pageCounter', 'count').catch(errorCode);
  r.check(
    'a key turned on after creation whose hook has configure warns and attaches nothing',
    late === 'not_found' && warnings.warned('attaches only when the WebView is created'),
    { late, warnings: warnings.lines }
  );
  // A hook that takes the navigation decision switches off the navigation rules: a warning says so, once per WebView.
  const taking =
    Platform.OS === 'ios'
      ? 'webView:decidePolicyForNavigationAction:decisionHandler:: a hook delegate'
      : 'shouldOverrideUrlLoading: a hook client';
  const taken = `${taking} takes it, so navigationRules, their defaults and onNavigationRequest don't apply to navigations`;
  const takenWarnings = captureWarnings();
  try {
    await recreate(h, { extensions: [sampleHook('hookNavigation')] }, true);
    for (const n of [1, 2]) {
      const to = fresh(h, `/spa.html?taken=${n}`);
      await h.ref.current?.evaluate(`(location.href = '${to}', 1)`).catch(errorCode);
      await waitFor(h, (s) => s.url === to && idle(s), 5000);
    }
    await until(() => takenWarnings.warned(taken), 3000, 100);
  } finally {
    takenWarnings.stop();
  }
  const takenLines = takenWarnings.lines.filter((line) => line.includes(taken));
  r.check(
    'a hook that takes the navigation decision warns once that the navigation rules do not apply',
    takenLines.length === 1,
    takenWarnings.lines
  );
  await recreate(h, { extensions: [sampleHook('hookDialogs'), sampleHook('subclass')] }, true);
  const made = await h.ref.current?.hook('sample.subclass', 'class').catch(errorCode);
  r.check(
    "its webViewClass (webViewFactory) makes the WebView it's enabled on",
    made === (Platform.OS === 'ios' ? 'SampleWKWebView' : 'SampleWebView'),
    made
  );
  h.events.hookEvents.length = 0;
  const after = await h.ref.current?.evaluate(`(alert('from the page'), 'after')`).catch(errorCode);
  // The event reaches JS on its own schedule, after the evaluate result at times.
  await until(() => h.events.hookEvents.includes('sample.hookDialogs.alert'), 3000, 100);
  r.check(
    'its UI delegate takes over a dialog the core implements (alert), with no dialog shown',
    after === 'after' && h.events.hookEvents.includes('sample.hookDialogs.alert'),
    { after, hookEvents: h.events.hookEvents }
  );
  await recreate(h, {}, true);
  // The hook's configure() runs before the package sets the view up. On iOS it turns on data detectors, which WebKit
  // reads only from the configuration, so the number becomes a tel: link; on Android it sets the monospace default font
  // size to 14px (13px without it).
  h.loadSource({
    html: '<p id="n">Call 415-555-0134 today</p><code id="c">x</code>',
    baseUrl: h.pages,
  });
  const configured =
    Platform.OS === 'ios'
      ? "document.querySelector('#n a[href^=tel]') !== null"
      : "(c => c !== null && getComputedStyle(c).fontSize === '14px')(document.getElementById('c'))";
  const applied = async () => (await h.ref.current?.evaluate(configured)) === true;
  r.check('its configure hook sets the WebView up', !!(await until(applied, 5000, 250)));
  if (Platform.OS === 'android') {
    await seams.setWebViewMissing(true);
    const errors = h.events.errors.length;
    let reloaded = false;
    try {
      h.setProps({ extensions: [sampleHook('noWebView')] });
      h.remount();
      await until(() => h.events.errors.length > errors, 3000);
      await seams.setWebViewMissing(false);
      reloaded = await waitForLoad(h, () => h.ref.current?.reload(), idle, 10000);
    } finally {
      await seams.setWebViewMissing(false);
    }
    const reported = h.events.errors.slice(errors);
    r.check(
      'a WebView that cannot be made (no WebView provider) reports onError, and reload() makes it and loads',
      reported.length === 1 &&
        reported[0]?.kind === 'network' &&
        reported[0].code === -1 &&
        reloaded &&
        h.events.outcomes.at(-1) === 'finished',
      { reported, reloaded, outcome: h.events.outcomes.at(-1) }
    );
  }
  await hookSeams(h, r);
  r.done();
}

/** The context's seams besides its delegate and client lists, through the `sample.seams` hook. */
async function hookSeams(h: Harness, r: ReturnType<typeof reporter>) {
  await recreate(h, { extensions: [sampleHook('seams')] }, true);
  const twice = await h.ref.current?.hook('sample.seams', 'twice', [21]).catch(errorCode);
  r.check('its handle handler reads a whole JS number as a Double', twice === 42, twice);
  if (Platform.OS === 'ios') {
    const tinted = await h.ref.current?.hook('sample.seams', 'tint').catch(errorCode);
    r.check(
      'its refreshControl, styled at attach, is the one pullToRefresh shows',
      tinted === true,
      tinted
    );
  }
  if (Platform.OS === 'android') {
    await openPage(h, fresh(h, '/media.html'));
    const [downloads, events] = [h.events.downloads.length, h.events.hookEvents.length];
    await click(h, 'attachment');
    const taken = await until(
      () => h.events.hookEvents.slice(events).includes('sample.seams.download'),
      10000
    );
    await click(h, 'blob');
    const passed = await waitFor(h, () => h.events.downloads.length > downloads, 20000);
    r.check(
      'its onDownloadStart handler takes an http download from onDownload and passes a blob: one on',
      !!taken && passed && h.events.downloads.length === downloads + 1,
      { taken, downloads: h.events.downloads.length - downloads }
    );
    // Its second touch listener counts a down and a cancel that its first one doesn't consume.
    const touches = await h.ref.current?.hook('sample.seams', 'touch').catch(errorCode);
    r.check('its touch listeners share the slot, in order', touches === 2, touches);
    h.loadSource({ html: '<div style="height: 5000px">tall</div>', baseUrl: h.pages });
    const scrolled = await until(
      async () => (await h.ref.current?.evaluate('(scrollTo(0, 400), scrollY > 0)')) === true,
      5000
    );
    const both = await until(
      () =>
        ['scrollA', 'scrollB'].every((name) =>
          h.events.hookEvents.includes(`sample.seams.${name}`)
        ),
      3000
    );
    r.check(
      'its two scroll listeners both get the scroll',
      !!scrolled && !!both,
      h.events.hookEvents
    );
  }
  const closed = await seams.closedViews();
  await recreate(h, {}, true);
  const now = await until(async () => {
    const count = await seams.closedViews();
    return count > closed && count;
  }, 3000);
  r.check(
    'its onDestroyed handler runs once its WebView is closed at unmount',
    now === closed + 1,
    { closed, now }
  );
}

/** First-load headers and shared cookies. */
async function network(h: Harness) {
  const r = reporter('network');

  const headersPage = fresh(h, '/headers');
  await openPage(h, { uri: headersPage, headers: { 'X-Test-Header': 'hello' } }, 10000);
  r.check(
    'source.headers reach the first request',
    (await text(h, 'headers')).includes('"x-test-header":"hello"')
  );

  await fetch(`${h.pages}/setcookie?name=fromNative&value=${Date.now()}`);
  await openPage(h, fresh(h, '/cookies'));
  r.check(
    'a cookie set by a native request reaches the page',
    (await text(h, 'cookies')).includes('fromNative='),
    await text(h, 'cookies')
  );
  await h.ref.current?.evaluate(`document.cookie = 'fromPage=${Date.now()}; path=/'`);
  // It reaches the shared store on the platform's schedule: ask until it shows.
  let native = '';
  await until(async () => {
    native = await fetch(`${h.pages}/cookies`).then((res) => res.text());
    return native.includes('fromPage=');
  }, 5000);
  r.check(
    'a cookie set by the page reaches native requests',
    native.includes('fromPage='),
    native.slice(0, 200)
  );
  // A cookie the page deletes (a logout) leaves native too, so the next source load doesn't bring it back.
  await h.ref.current?.evaluate(
    "document.cookie = 'fromPage=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'"
  );
  await until(
    async () =>
      !(await fetch(`${h.pages}/cookies`).then((res) => res.text())).includes('fromPage='),
    5000
  );
  await openPage(h, fresh(h, '/cookies'));
  r.check(
    'a cookie the page deletes stays deleted after the next source load',
    !(await text(h, 'cookies')).includes('fromPage='),
    await text(h, 'cookies')
  );

  r.done();
}

/**
 * Goes back or forward (`go`) to `url`, titled `title`, with an entry after it when `back`: checks that it comes from the
 * back-forward cache with one finished load and a working bridge. Returns what a way to build the history changes.
 */
async function travel(
  h: Harness,
  r: ReturnType<typeof reporter>,
  name: string,
  go: () => void,
  url: string,
  title: string,
  back: boolean
) {
  clearEvents(h);
  go();
  await waitFor(h, (s) => s.url === url && idle(s));
  await sleep(500); // a late state or load event would come now
  const shows = (await h.ref.current?.evaluate('window.shows')) as boolean[] | undefined;
  r.since(
    WEBVIEW.navigationListener,
    `${name}: the page is restored from the cache`,
    shows?.[1] === true,
    shows
  );
  const s = h.state();
  r.check(
    `${name}: the state is the restored page's`,
    s.url === url && s.title === title && s.canGoBack && s.canGoForward === back,
    s
  );
  r.check(
    `${name}: one load start and end, finished`,
    JSON.stringify(h.events.loads) === '["start","end"]' &&
      JSON.stringify(h.events.outcomes) === '["finished"]',
    { loads: h.events.loads, outcomes: h.events.outcomes }
  );
  const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
  r.since(WEBVIEW.bridge, `${name}: RN -> page call`, sum === 5, sum);
  h.bridge.emit('nativeEvent', { n: 7 });
  await until(
    async () =>
      ((await h.ref.current?.evaluate('window.lastEvent')) as { n?: number } | null)?.n === 7,
    3000
  );
  const event = await h.ref.current?.evaluate('window.lastEvent');
  r.since(
    WEBVIEW.bridge,
    `${name}: RN -> page event`,
    (event as { n?: number } | null)?.n === 7,
    event
  );
  await h.ref.current?.evaluate('window.lastEvent = null');
  const echo = await pageCall(h, 'echo', { url });
  r.since(
    WEBVIEW.bridge,
    `${name}: page -> RN call`,
    (echo.result as { url?: string } | undefined)?.url === url,
    echo
  );
  return { shows, canGoBack: s.canGoBack, canGoForward: s.canGoForward };
}

/**
 * Back and forward restored from the back-forward cache (WebKit always, Android by default): the restore itself, the
 * navigation state, one onLoadStart/onLoadEnd per restore, the bridge both ways, and the rules on the restored
 * page.
 */
async function bfcache(h: Harness) {
  const r = reporter('bfcache');
  await openPage(h, fresh(h, '/')); // so the first page has one before it
  const first = fresh(h, '/back-forward.html?title=first');
  await openPage(h, first);
  const second = fresh(h, '/back-forward.html?title=second');
  await openPage(h, second);

  await travel(h, r, 'back', () => h.ref.current?.goBack(), first, 'first', true);
  await travel(h, r, 'forward', () => h.ref.current?.goForward(), second, 'second', false);

  // A call still unanswered when its page goes into the cache rejects at once; the answer the page sends once restored
  // is dropped. Both ways: the page's call to the app's 'slow' (answered after 5 s) rejects in the page.
  const straddleCall = `(() => {
    window.__straddle = undefined;
    nativeBridge.call('slow').then((result) => (window.__straddle = { result }), (error) => (window.__straddle = { error: error.code }));
  })()`;
  await h.ref.current?.evaluate(straddleCall).catch(errorCode);
  // Without the bridge the call rejects at once, before the page is left.
  let left = Date.now();
  const inFlight = h.bridge.call('slow', { ms: 1500 }).then(
    (value) => ({ value, ms: Date.now() - left }),
    (error: unknown) => ({ code: errorCode(error), ms: Date.now() - left })
  );
  await sleep(200);
  left = Date.now();
  h.ref.current?.goBack();
  const settled = await inFlight;
  r.since(
    WEBVIEW.bridge,
    'a call in flight when the page is left rejects with navigated',
    'code' in settled && settled.code === 'navigated' && settled.ms < 1000,
    settled
  );
  await waitFor(h, (s) => s.url === first && idle(s));
  h.ref.current?.goForward();
  await waitFor(h, (s) => s.url === second && idle(s));
  await sleep(2000); // the restored page's timer fires and it answers the old call
  const straddle = (await h.ref.current?.evaluate('window.__straddle')) as
    { error?: string } | null | undefined;
  r.since(
    WEBVIEW.navigationListener,
    'a page -> RN call cut off by leaving the page rejects with navigated',
    straddle?.error === 'navigated',
    straddle
  );
  const after = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.since(WEBVIEW.bridge, 'the bridge works after the late answer', after === 2, after);

  const asked = await allowAsks(h, [
    { path: ['/checkout'], action: 'ask' },
    { path: ['/blocked'], action: 'block' },
  ]);
  const blocked = await nextDecision(
    h,
    () => h.ref.current?.evaluate(`location.href = '/blocked/page'`),
    '/blocked/page'
  );
  r.check(
    'a block rule holds on the restored page',
    blocked?.action === 'block' && h.state().url === second,
    { decision: blocked, state: h.state() }
  );
  await h.ref.current?.evaluate(`location.href = '/checkout/pay?bf=1'`);
  r.check(
    'an ask rule asks on the restored page and allow loads it',
    (await waitFor(h, (s) => s.url.endsWith('/checkout/pay?bf=1') && idle(s), 5000)) &&
      asked.length === 1,
    { asked, state: h.state() }
  );
  r.done();
}

/** `source.body` (a form POST, sent again by reload) and a `file://` source with its own assets. */
async function sources(h: Harness) {
  const r = reporter('sources');

  const body = `amount=9.99&t=${Date.now()}`;
  // The WebView commits the second form with its host lowercase.
  for (const [form, host] of [
    ['', 'localhost'],
    [' when the source URL has an uppercase host', 'LOCALHOST'],
  ]) {
    const post = fresh(h, '/post');
    await waitForLoad(
      h,
      () => h.loadSource({ uri: post.replace('localhost', host), body }),
      (s) => s.url === post && idle(s),
      10000
    );
    if (!form)
      r.check(
        'source.body is sent as a form POST',
        (await text(h, 'body')) === body,
        await text(h, 'body')
      );
    await h.ref.current?.evaluate(`document.getElementById('body').textContent = 'stale'`);
    await waitForLoad(
      h,
      () => h.ref.current?.reload(),
      () => true,
      10000
    );
    await until(async () => (await text(h, 'body').catch(() => 'stale')) !== 'stale', 3000);
    r.check(
      `reload sends the POST again${form}`,
      (await text(h, 'body')) === body,
      await text(h, 'body')
    );
  }

  // The source load skips the rules: WebKit puts an html source through them at its baseUrl.
  h.setRules([]);
  await waitForLoad(h, () =>
    h.loadSource({ html: '<p id="html">html source</p>', baseUrl: `${h.pages}/base/` })
  );
  r.check(
    'an html source loads when the rules block every navigation',
    (await text(h, 'html')) === 'html source',
    await text(h, 'html')
  );
  // WebKit's reload fetches an html source's baseUrl instead.
  await h.ref.current?.evaluate(`document.getElementById('html').textContent = 'stale'`);
  await waitForLoad(h, () => h.ref.current?.reload());
  await until(async () => (await text(h, 'html').catch(() => 'stale')) !== 'stale', 3000);
  r.check(
    'reload shows the html source again',
    (await text(h, 'html')) === 'html source',
    await text(h, 'html')
  );
  h.setRules(undefined);

  const dir = new Directory(Paths.cache, `site-${Date.now()}`);
  dir.create();
  await new File(dir, 'style.css').write('body { color: rgb(1, 2, 3) }');
  await new File(dir, 'app.js').write('window.__asset = 1');
  const index = new File(dir, 'index.html');
  await index.write(
    '<!doctype html><link rel="stylesheet" href="style.css"><script src="app.js"></script><p id="local">local</p>'
  );
  if (Platform.OS === 'android') h.setProps({ android: { settings: { allowFileAccess: true } } });
  await waitForLoad(
    h,
    () => h.loadSource({ uri: index.uri }),
    (s) => s.url.endsWith('/index.html') && idle(s),
    10000
  );
  const loaded = await h.ref.current?.evaluate(
    `[getComputedStyle(document.body).color, window.__asset, document.getElementById('local')?.textContent]`
  );
  r.check(
    'a file:// source loads with its own stylesheet and script',
    JSON.stringify(loaded) === JSON.stringify(['rgb(1, 2, 3)', 1, 'local']),
    { loaded, url: h.state().url }
  );
  if (Platform.OS === 'ios') {
    // react-native-webview's private keys: a file: page fetches a sibling file only with the first, and a server that
    // sends no CORS headers (this one) only with the second.
    const read = async (url: string) =>
      await h.ref.current?.evaluate(`fetch('${url}').then((r) => r.text(), () => 'blocked')`);
    const server = `${h.pages}/common.js`;
    const without = [await read('app.js'), await read(server)];
    h.setProps({ ios: { preferences: { allowFileAccessFromFileURLs: true } } });
    await until(
      async () =>
        (await h.ref.current?.get('preferences.allowFileAccessFromFileURLs').catch(errorCode)) ===
        true,
      3000
    );
    await waitForLoad(h, () => h.ref.current?.reload(), idle, 10000);
    const sibling = await read('app.js');
    r.check(
      'ios.preferences.allowFileAccessFromFileURLs lets a file: page fetch a sibling file',
      without[0] === 'blocked' && sibling === 'window.__asset = 1',
      { without: without[0], sibling }
    );
    await recreate(h, { ios: { configuration: { allowUniversalAccessFromFileURLs: true } } });
    const universal = await read(server);
    r.check(
      'ios.configuration.allowUniversalAccessFromFileURLs lets it fetch from a server with no CORS headers',
      without[1] === 'blocked' && String(universal).includes('window.testLog = []'),
      { without: without[1], universal: String(universal).slice(0, 40) }
    );
  }
  dir.delete();
  r.done();
}

/**
 * The ref's `load`: in place (same handle, the bridge carries on), a history entry that back, forward and the
 * back-forward cache treat as a tapped link's, no dedupe, past rules that block every navigation (its redirect still
 * goes to them) also when a load or a source change came in the same tick, `source` and reload left as they were, and a
 * load from the moment a remounted WebView attaches its ref (on iOS while its `source` waits for the shared cookies).
 */
async function refLoad(h: Harness) {
  const r = reporter('refLoad');
  const home = fresh(h, '/');
  await openPage(h, home);
  const handle = h.ref.current;
  const page = fresh(h, '/bridge.html');
  const loadPage = (url: string) =>
    waitForLoad(
      h,
      () => h.ref.current?.load(url),
      (s) => s.url === url && idle(s)
    );
  const historyLength = async () => (await h.ref.current?.evaluate('history.length')) as number;
  const entries = await historyLength();
  r.check('load loads the URL', await loadPage(page), h.state());
  r.check('the same WebView, not a remount', h.ref.current === handle);
  const added = (await historyLength()) - entries;
  r.check('as a new history entry', added === 1 && h.state().canGoBack, {
    added,
    state: h.state(),
  });
  r.since(
    WEBVIEW.bridge,
    'the bridge works on the loaded page',
    (await h.bridge.call('sum', { a: 1, b: 2 }).catch(errorCode)) === 3
  );

  await h.ref.current?.evaluate('window.__mark = 1');
  const loads = h.events.loads.length;
  const again = await loadPage(page);
  r.check(
    'loading the page on screen loads it again',
    again && (await h.ref.current?.evaluate('window.__mark ?? null')) === null,
    { loads: h.events.loads.slice(loads) }
  );
  const same = (await historyLength()) - entries - 1;
  r.check('loading the page on screen adds no history entry', same === 0, same);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  await sleep(200);
  await loadPage(fresh(h, '/bridge.html'));
  r.since(
    WEBVIEW.bridge,
    'a load rejects the bridge calls in flight',
    (await inFlight) === 'navigated'
  );

  // App's `source` is still `home`: the same one again loads nothing, and reload reloads the loaded page.
  const shown = h.state().url;
  const before = h.events.loads.length;
  h.loadSource({ uri: home });
  await sleep(1000);
  r.check(
    'a re-render with the same source loads nothing',
    h.events.loads.length === before && h.state().url === shown,
    { loads: h.events.loads.slice(before), state: h.state() }
  );
  await h.ref.current?.evaluate('window.__mark = 1');
  await waitForLoad(h, () => h.ref.current?.reload());
  r.check(
    "reload reloads the loaded page, not the source's",
    h.state().url === shown && (await h.ref.current?.evaluate('window.__mark ?? null')) === null,
    h.state()
  );

  await refLoadHistory(h, r);

  h.setRules([]);
  await sleep(300);
  h.events.navigations.length = 0;
  const allowed = fresh(h, '/');
  r.check('load skips rules that block every navigation', await loadPage(allowed), h.state());
  await sleep(300);
  r.check(
    'a load is not reported to onNavigation',
    h.events.navigations.length === 0,
    h.events.navigations
  );
  const redirected = `${h.pages}/redirect?to=/blocked`;
  await waitForLoad(h, () => h.ref.current?.load(redirected));
  await sleep(300);
  r.check(
    "the load's redirect goes to the rules",
    h.events.navigations.some((n) => n.action === 'block' && n.url.endsWith('/blocked')) &&
      h.state().url === allowed,
    { navigations: h.events.navigations, state: h.state() }
  );
  await refLoadRaces(h, r);
  h.setRules(undefined);
  await refLoadEdges(h, r);
  r.done();
}

/** Two ways to go to `url` from a page: the app's load, and a tap on a link (a click from script on iOS, see `tap`). */
const NAVIGATIONS = [
  ['load', (h: Harness, _r: ReturnType<typeof reporter>, url: string) => h.ref.current?.load(url)],
  [
    'link',
    async (h: Harness, r: ReturnType<typeof reporter>, url: string) => {
      await h.ref.current?.evaluate(`(() => {
        document.getElementById('link')?.remove();
        const a = Object.assign(document.createElement('a'), { id: 'link', href: ${JSON.stringify(url)}, textContent: 'link' });
        a.style.cssText = 'display: block; padding: 24px; font-size: 32px';
        document.body.append(a);
      })()`);
      await tap(h, r, 'link');
    },
  ],
] as const;

/**
 * The same history built with a load and with a tapped link: back and forward come from the back-forward cache alike,
 * and `goBack` lands alike after the page's `pushState` without a gesture (Android skips such an entry). The referrer
 * and the headers a load sends instead of a link's are only logged.
 */
async function refLoadHistory(h: Harness, r: ReturnType<typeof reporter>) {
  const ways: Record<string, unknown> = {};
  for (const [way, go] of NAVIGATIONS) {
    const a = fresh(h, `/back-forward.html?title=${way}A`);
    await openPage(h, a);
    const b = fresh(h, `/back-forward.html?title=${way}B`);
    const arrived = await waitForLoad(
      h,
      () => go(h, r, b),
      (s) => s.url === b && idle(s)
    );
    r.check(`${way}: goes to the page`, arrived && h.state().canGoBack, h.state());
    const back = await travel(
      h,
      r,
      `${way}: back`,
      () => h.ref.current?.goBack(),
      a,
      `${way}A`,
      true
    );
    const forward = await travel(
      h,
      r,
      `${way}: forward`,
      () => h.ref.current?.goForward(),
      b,
      `${way}B`,
      false
    );
    const pushed = await backAfterPushState(h, a, b);
    const lands =
      Platform.OS === 'android' ? 'the page before it (its entry skipped)' : 'the page itself';
    r.check(
      `${way}: goBack after the page's pushState without a gesture lands on ${lands}`,
      pushed === lands,
      pushed
    );
    ways[way] = { back, forward, pushed };
    const headers = fresh(h, '/headers');
    await waitForLoad(
      h,
      () => go(h, r, headers),
      (s) => s.url === headers && idle(s)
    );
    const sent = JSON.parse((await text(h, 'headers')) || '{}') as Record<string, string>;
    r.info(`${way}: referrer and request headers`, {
      referrer: await h.ref.current?.evaluate('document.referrer'),
      referer: sent.referer,
      secFetchSite: sent['sec-fetch-site'],
      secFetchUser: sent['sec-fetch-user'],
    });
  }
  r.check(
    'a load and a tapped link restore, travel and go back alike',
    JSON.stringify(ways.load) === JSON.stringify(ways.link),
    ways
  );
}

/** On page `b`, after page `a`: pushes an entry without a gesture, goes back, and says where that lands. */
async function backAfterPushState(h: Harness, a: string, b: string) {
  await h.ref.current?.evaluate("history.pushState(null, '', '#pushed')");
  await waitFor(h, (s) => s.url === `${b}#pushed`);
  h.ref.current?.goBack();
  await waitFor(h, (s) => s.url !== `${b}#pushed` && idle(s));
  await sleep(500); // a load the back starts late would show now
  const { url } = h.state();
  if (url === a) return 'the page before it (its entry skipped)';
  return url === b ? 'the page itself' : url;
}

/** How the first of two app loads in a row starts: a load (the second follows in a 0 ms timeout) or a source change. */
const FIRST_LOADS = [
  ['a load', (h: Harness, url: string) => h.ref.current?.load(url)],
  ['a source change', (h: Harness, url: string) => h.loadSource({ uri: url })],
] as const;

/**
 * A load right after another load or a source change: on iOS without sharedCookies it starts before the first one's
 * policy check (a single own-load slot let that check go to the rules); with them it replaces the
 * first while that is prepared. In the same tick as a source change, which one ends on screen is only logged: the
 * TSDoc leaves it open.
 */
async function refLoadRaces(h: Harness, r: ReturnType<typeof reporter>) {
  for (const sharedCookies of [false, true]) {
    h.setProps({ sharedCookies });
    await sleep(300);
    for (const [name, first] of FIRST_LOADS) {
      const reported: unknown[] = [];
      let wrong: NavigationState | undefined;
      let run: Awaited<ReturnType<typeof loadAfter>> | undefined;
      const tries = name === 'a load' && !sharedCookies ? 5 : 1;
      for (let i = 0; i < tries; i++) {
        run = await loadAfter(h, name, first);
        reported.push(...run.reported);
        wrong ??= run.wrong;
      }
      if (name === 'a source change')
        r.info(
          `on screen after a source change and a load in the same tick (sharedCookies ${sharedCookies})`,
          run?.onLoad ? 'the load' : 'the source'
        );
      r.check(
        `neither ${name} nor a load right after it goes to the rules (sharedCookies ${sharedCookies})`,
        reported.length === 0 && !wrong,
        { reported, wrong }
      );
    }
  }
  h.setProps({});
}

/** Starts `first`, then a load right after it: the main-frame navigations reported, and the state if it went wrong. */
async function loadAfter(
  h: Harness,
  name: (typeof FIRST_LOADS)[number][0],
  first: (typeof FIRST_LOADS)[number][1]
) {
  h.events.navigations.length = 0;
  const earlier = fresh(h, '/?first');
  const loaded = fresh(h, '/');
  const ended = await waitForLoad(
    h,
    () => {
      first(h, earlier);
      if (name === 'a load') setTimeout(() => h.ref.current?.load(loaded), 0);
      else h.ref.current?.load(loaded);
    },
    (s) => [earlier, loaded].includes(s.url) && idle(s)
  );
  await sleep(300);
  const reported = h.events.navigations.filter((n) => n.mainFrame);
  const wrong = !ended || (name === 'a load' && h.state().url !== loaded) ? h.state() : undefined;
  return { reported, wrong, onLoad: h.state().url === loaded };
}

/** What `load` refuses or can't load, and a load as a remounted WebView attaches its ref. */
async function refLoadEdges(h: Harness, r: ReturnType<typeof reporter>) {
  const warnings = captureWarnings();
  const quiet = h.events.loads.length;
  // eslint-disable-next-line no-script-url -- because load must refuse it
  h.ref.current?.load(`javascript:document.title = 'ran'`);
  await sleep(500);
  warnings.stop();
  r.check(
    'a javascript: URL loads and runs nothing, with a warning',
    h.events.loads.length === quiet &&
      h.state().title !== 'ran' &&
      warnings.warned('load: a javascript: URL'),
    { loads: h.events.loads.slice(quiet), title: h.state().title, warnings: warnings.lines }
  );

  const outcomes = h.events.outcomes.length;
  await waitForLoad(h, () => h.ref.current?.load('minimal-webview-unknown:page'));
  r.check(
    'a URL the platform cannot load ends as failed',
    h.events.outcomes[outcomes] === 'failed',
    { outcomes: h.events.outcomes.slice(outcomes), errors: h.events.errors }
  );

  const early = fresh(h, '/bridge.html');
  const old = h.ref.current;
  const mounted = await waitForLoad(
    h,
    () => {
      const stop = h.ref.subscribe(() => {
        const next = h.ref.current;
        if (!next || next === old) return;
        stop();
        next.load(early);
      });
      h.remount();
    },
    (s) => s.url === early && idle(s)
  );
  r.check('a load as a remounted WebView attaches its ref waits for the view', mounted, h.state());
}

/**
 * In run order: `maestro/run.sh` runs these keys when it is given no suites. A suite reports `skipped` on a platform it
 * doesn't apply to, leaves nothing behind that `reset()` doesn't undo, and needs no site but the test pages server.
 */
export const SUITES: Record<string, (h: Harness) => Promise<void>> = {
  urlTracking,
  navigation,
  reissue,
  bridge,
  bfcache,
  injection,
  errors,
  crash,
  mountSettings,
  settings,
  upload,
  downloads: downloadsSuite,
  permissions: permissionsSuite,
  fullscreen,
  ua,
  dialogs,
  sampleExtension,
  extensions,
  ptr,
  network,
  sources,
  refLoad,
  shapes,
  hostile,
};

/** Timings, run only when named (`maestro/run.sh <platform> <device> perfCold perf`): a full run leaves them out. */
const ON_DEMAND: Record<string, (h: Harness) => Promise<void>> = { perf, perfCold };
