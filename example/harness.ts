// Scripted spike checks. Results go to the JS console as `[harness] PASS|FAIL|INFO ...` lines, readable from
// logcat (ReactNativeJS) or the Metro log, so no screenshots are needed.
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
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
} from 'minimal-rn-webview';
import { WebView, WK } from 'minimal-rn-webview';
import { AppState, Platform } from 'react-native';

export type Harness = {
  pages: string;
  platform: string;
  ref: WebViewRefObject;
  /** Where the WebView sits in the window, in dp, for a driver's TAP; kept current by App's onLayout. */
  webViewOffset: { x: number; y: number };
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
  setFileRequest: (
    handler: ((request: FileRequest) => Promise<string[] | null>) | undefined
  ) => void;
  setPermission: (handler: ((request: PermissionRequest) => Promise<boolean>) | undefined) => void;
  /** Extra WebView props, replacing the previous extras. An `ios` keeps the example's `configuration` unless it has one. */
  setProps: (props: Partial<WebViewProps>) => void;
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
    /** The names of the hooks' other events. */
    hookEvents: string[];
    /** Whether the example's error screen (the docs/props.md recipe) is mounted. */
    overlay: { error: boolean };
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * What the harness wants from an outside driver, shown on screen (testID `harness-request`) so a UI test tool can wait
 * for it: `<suite>#<n> <REQUEST> <detail>` for each request (upper-case `info` names), `<suite>#done pass=… fail=…` last.
 */
let showRequest: (text: string) => void = () => {};
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

function reporter(suite: string) {
  let pass = 0;
  let fail = 0;
  let requests = 0;
  return {
    check(name: string, ok: boolean, detail: unknown = '') {
      if (ok) pass++;
      else fail++;
      emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
    },
    info(name: string, detail: unknown) {
      if (/^[A-Z]+$/.test(name))
        request(`${suite}#${++requests} ${name} ${JSON.stringify(detail)}`);
      emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
    },
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
    const suite = SUITES[name];
    try {
      if (suite) await suite(current);
      else emit(`FAIL unknown suite ${name}`);
    } catch (error) {
      // A thrown suite reports as a failure instead of leaving the harness busy forever.
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
 * props, the event logs, and a new WebView (a platform settings key is not reset by its absence).
 */
async function reset(h: Harness) {
  h.setProps({});
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setPermission(undefined);
  h.setFileRequest(undefined);
  const loads = h.events.loads.length;
  h.remount();
  // The state is the old WebView's until the new one reports: wait for the new one's load to end.
  await waitFor(h, (s) => s.url !== '' && idle(s) && h.events.loads.slice(loads).includes('end'));
  clearEvents(h);
}

/** Polls `fn` until it returns something truthy, and returns that; undefined after `ms`. */
async function until<T>(fn: () => T | Promise<T>, ms = 10000, step = 100): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(step)) {
    const value = await fn();
    if (value) return value;
  }
  return undefined;
}

const waitFor = async (h: Harness, predicate: (s: NavigationState) => boolean, ms = 10000) =>
  (await until(() => predicate(h.state()), ms, 50)) === true;

const idle = (s: NavigationState) => !s.loading && s.pendingUrl === null;
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
const click = (h: Harness, id: string) =>
  h.ref.current?.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);

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

const webViewMajors = new WeakMap<object, Promise<number>>();
/**
 * Checks `name`, or reports it as INFO on an Android WebView older than 146, where it fails by design (no
 * NAVIGATION_LISTENER; ROADMAP's known limits). The version is read once per suite run (per reporter).
 */
async function checkUnlessOldWebView(
  h: Harness,
  r: ReturnType<typeof reporter>,
  name: string,
  ok: boolean,
  detail: unknown = ''
) {
  if (!webViewMajors.has(r))
    webViewMajors.set(
      r,
      Platform.OS === 'android'
        ? Promise.resolve(h.ref.current?.evaluate('navigator.userAgent')).then(
            (ua) => Number(/Chrome\/(\d+)/.exec(String(ua))?.[1] ?? 0),
            () => 0
          )
        : Promise.resolve(0)
    );
  const major = await webViewMajors.get(r)!;
  if (major > 0 && major < 146)
    r.info(`known limit (WebView <146): ${name}`, { major, ok, detail });
  else r.check(name, ok, detail);
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

  // 5.2: what url and pendingUrl show while a slow navigation is in flight
  const beforeSlow = h.state().url;
  await h.ref.current?.evaluate(`location.href = '/slow?ms=3000'`);
  await sleep(1000);
  const during = h.state();
  r.info('during slow load', {
    url: during.url,
    pendingUrl: during.pendingUrl,
    loading: during.loading,
  });
  r.check('url keeps the committed page while loading', during.url === beforeSlow, during);
  await checkUnlessOldWebView(
    h,
    r,
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

  // A remount App doesn't re-render for: useWebViewState and getState() follow the new WebView, which loads the
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

// Android cancel-and-reissue: `ask` rules cancel the navigation, JS answers, `allow` reloads the URL.
async function reissue(h: Harness) {
  const r = reporter('reissue');
  const asked: string[] = [];
  let answer: 'allow' | 'block' | 'late' = 'allow';
  h.setAsk(async (request) => {
    asked.push(request.url);
    if (answer === 'late') await sleep(1500);
    return answer === 'block' ? 'block' : 'allow';
  });
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

  answer = 'block';
  await click(h, 'checkout');
  await sleep(1500);
  r.check('block stays on the page', h.state().url === start && asked.length === 2, {
    url: h.state().url,
    asked,
  });

  answer = 'late';
  await click(h, 'checkout');
  await sleep(2500);
  r.check(
    'a late answer is ignored (timeout blocks)',
    h.state().url === start && asked.length === 3,
    { url: h.state().url, asked }
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
  await sleep(1500);
  // Android cannot hold a navigation, so `ask` falls back to block for iframes; iOS holds the handler and asks.
  if (Platform.OS === 'android') {
    r.check(
      'iframe navigations into an ask rule are blocked without asking',
      asked.length === beforeFrame,
      asked
    );
  } else {
    r.check('iframe navigations into an ask rule are asked', asked.length > beforeFrame, asked);
  }

  // The page goes as the referrer: in full to its own origin, only its origin to another.
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

const errorCode = (error: unknown) => (error as { code?: string }).code;

/** Starts a page-side `nativeBridge.call` and waits for its outcome. */
async function pageCall(h: Harness, method: string, params: unknown) {
  await h.ref.current?.evaluate(`(() => {
    window.__call = undefined;
    nativeBridge.call(${JSON.stringify(method)}, ${JSON.stringify(params)}).then(
      (result) => (window.__call = { result }),
      (error) => (window.__call = { error: error.code })
    );
  })()`);
  const outcome = await until(() => h.ref.current?.evaluate('window.__call'), 6000, 100);
  return (outcome ?? { error: 'harness timeout' }) as { result?: unknown; error?: string };
}

async function bridge(h: Harness) {
  const r = reporter('bridge');
  const page = fresh(h, '/bridge.html');
  await openPage(h, page);
  const bridgeType = await h.ref.current?.evaluate(
    '[typeof window.nativeBridge, location.href, document.readyState]'
  );
  r.check('page sees window.nativeBridge', (bridgeType as string[])?.[0] === 'object', {
    bridgeType,
    state: h.state(),
  });

  // evaluate: one contract on both platforms.
  const evaluate = (script: string) => h.ref.current?.evaluate(script);
  const plain = await evaluate(`({ n: 1 + 1, s: 'x', a: [true, null] })`);
  r.check(
    'evaluate returns a plain value',
    JSON.stringify(plain) === '{"n":2,"s":"x","a":[true,null]}',
    plain
  );
  const awaited = await evaluate(
    `new Promise((resolve) => setTimeout(() => resolve('late'), 300))`
  );
  r.check('evaluate awaits a Promise', awaited === 'late', awaited);
  const unencodable = await Promise.all(
    ['() => 1', 'NaN', '(() => { const o = {}; o.o = o; return o; })()'].map(evaluate)
  );
  r.check(
    'evaluate gives null for what JSON cannot encode',
    unencodable.every((v) => v === null),
    unencodable
  );
  const thrown = await Promise.all(
    [`(() => { throw new Error('boom'); })()`, `Promise.reject(new Error('no'))`, '1 +'].map((s) =>
      evaluate(s)?.catch(errorCode)
    )
  );
  r.check(
    'evaluate rejects script_error on a throw, a rejection or a syntax error',
    thrown.every((c) => c === 'script_error'),
    thrown
  );
  const boom = await evaluate(`(() => { throw new Error('boom') })()`)?.catch(
    (error: unknown) => (error as Error).message
  );
  r.check("evaluate rejects with the thrown error's message", String(boom).includes('boom'), boom);

  r.check('RN -> page call', (await h.bridge.call('sum', { a: 2, b: 3 })) === 5);
  r.check('RN -> page awaits a page Promise', (await h.bridge.call('pageSlow')) === 'late');
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
  await h.ref.current?.evaluate(`nativeBridge.emit('pageEvent', { n: 2 })`);
  await waitFor(h, () => h.pageEvents.length > before, 3000);
  await sleep(200); // a duplicate would come right after
  r.check('page -> RN event', h.pageEvents.length === before + 1, h.pageEvents);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  const pending = evaluate('new Promise(() => {})')?.catch(errorCode);
  await sleep(200);
  h.load(`${page}&next=1`);
  r.check('navigation rejects calls in flight', (await inFlight) === 'navigated');
  const gone = await pending;
  r.check('navigation rejects an evaluate in flight', gone === 'navigated', gone);
  await waitFor(h, (s) => s.url.includes('next=1') && idle(s));
  await sleep(500);
  r.check(
    'the bridge works again after navigation',
    (await h.bridge.call('sum', { a: 1, b: 1 })) === 2
  );

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
    // The Document ends at unmount, from invalidate: deinit, the fallback, can no longer reject (its self is nil).
    const unmounted = evaluate('new Promise(() => {})')?.catch(errorCode);
    await sleep(200);
    h.remount();
    const closed = await Promise.race([unmounted, sleep(3000).then(() => 'still pending')]);
    r.check('unmount rejects an evaluate in flight', closed === 'navigated', closed);
  }
  r.done();
}

/**
 * The `pullToRefresh` prop. The gesture comes from outside the app: the suite logs `INFO ptr: SWIPE "<kind>"` and the
 * driver (adb input swipe / agent-device swipe) performs it.
 */
async function ptr(h: Harness) {
  const r = reporter('ptr');
  // Rejects with `navigated` when the pull's reload replaces the page mid-call: read it again on the next poll.
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
  // Off, the layout stays around the WebView and takes no pull. The next setProps turns it back on (the app's
  // default), and the failing reload's pull below needs it on.
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
  h.setFileRequest(async (request) => {
    requests.push(request);
    if (hang) return await new Promise<null>(() => {});
    return answer;
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

  // A handler that never settles holds the page's chooser (WebView allows one); the next page cancels it.
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
  await open();
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
    r.check(`back cancels it (${label})`, logged?.includes('cancelled') ?? false, logged);
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

/** Empties every event log. */
const clearEvents = (h: Harness) => {
  for (const log of Object.values(h.events)) if (Array.isArray(log)) log.length = 0;
  h.pageEvents.length = 0;
};

/** A test page's URL with a cache-buster: `path` on the test pages server, or a full URL. */
const fresh = (h: Harness, path: string) =>
  `${path.startsWith('http') ? '' : h.pages}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;

/**
 * Sets props that recreate the WebView (a creation-time setting) and waits until the new one has loaded its page. The
 * state is the old page's until the new view reports, so `idle` alone could match too early. With `remount`, for props
 * that don't recreate it (`hookOptions`, whose keys pick the hooks only when it is created), it remounts too.
 */
async function recreate(h: Harness, props: Partial<WebViewProps>, remount = false) {
  const loads = h.events.loads.length;
  h.setProps(props);
  if (remount) h.remount();
  return await waitFor(h, (s) => h.events.loads.slice(loads).includes('end') && idle(s), 15000);
}

/** Loads `uri` and waits until it is the idle page and its load has ended. */
async function openPage(h: Harness, uri: string, ms = 15000) {
  const loads = h.events.loads.length;
  h.load(uri);
  const ok = await waitFor(
    h,
    (s) => s.url === uri && idle(s) && h.events.loads.slice(loads).includes('end'),
    ms
  );
  await sleep(100); // events the native side sends right after onLoadEnd (onNavigation, an extension's)
  return ok;
}

/** Runs `act`, then waits for the lines the page adds to `window.testLog`; null when none come within `ms`. */
async function pageLog(h: Harness, act: () => unknown, ms = 10000) {
  const before = ((await h.ref.current?.evaluate('window.testLog.length')) as number) ?? 0;
  await act();
  return (
    (await until(async () => {
      const lines = (await h.ref.current?.evaluate(`window.testLog.slice(${before})`)) as string[];
      return lines?.length ? lines : undefined;
    }, ms)) ?? null
  );
}

/** An element's text, '' when it is missing. */
const text = async (h: Harness, id: string) =>
  (await h.ref.current?.evaluate(
    `document.getElementById(${JSON.stringify(id)})?.textContent ?? ''`
  )) as string;

/**
 * Android: the screen pixels of an element's centre, `x y`, for a driver's TAP; with `frame`, of an element inside
 * that same-origin iframe.
 */
const tapPoint = async (h: Harness, id: string, frame?: string) =>
  (
    (await h.ref.current?.evaluate(`(() => {
    const f = ${frame ? `document.getElementById(${JSON.stringify(frame)})` : 'null'};
    const e = (f ? f.contentDocument : document).getElementById(${JSON.stringify(id)});
    (f ?? e).scrollIntoView({ block: 'center' });
    const fr = f?.getBoundingClientRect(), x = fr ? fr.left + f.clientLeft : 0, y = fr ? fr.top + f.clientTop : 0;
    const b = e.getBoundingClientRect(), d = devicePixelRatio;
    return [
      Math.round((${h.webViewOffset.x} + x + b.left + b.width / 2) * d),
      Math.round((${h.webViewOffset.y} + y + b.top + b.height / 2) * d),
    ];
  })()`)) as [number, number]
  ).join(' ');

/**
 * Main-frame errors only, the URL after a failure, how each kind of load ends (`outcome`), the error screen recipe in
 * docs/props.md (the example's ErrorScreen), and reload recovering.
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

  // Loads that never show a page end as cancelled. Android before 146 reports nothing for them: they never commit.
  const stopped = await outcomeOf(async () => {
    h.load(fresh(h, '/slow?ms=3000'));
    await waitFor(h, (s) => s.loading, 3000);
    h.ref.current?.stopLoading();
  }, 5000);
  await checkUnlessOldWebView(
    h,
    r,
    'a stopped load ends as cancelled',
    stopped === 'cancelled',
    stopped
  );
  const noContent = await outcomeOf(() => h.load(fresh(h, '/status/204')), 5000);
  await checkUnlessOldWebView(
    h,
    r,
    'a 204 ends as cancelled',
    noContent === 'cancelled',
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
  await checkUnlessOldWebView(
    h,
    r,
    'a redirect the rules block ends as cancelled',
    blocked === 'cancelled',
    blocked
  );
  h.setRules(undefined);

  clearEvents(h);
  h.load('https://localhost:8443/'); // the test server's self-signed certificate
  const gotSsl = await waitFor(h, () => h.events.errors.length > 0, 10000);
  r.check('ssl error', gotSsl && h.events.errors[0]?.kind === 'ssl', h.events.errors[0]);

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
  h.setProps({ userAgent: 'CustomAgent/2.0' });
  await sleep(500);
  const custom = await read();
  r.check(
    'userAgent replaces the whole UA',
    custom.header === 'CustomAgent/2.0' && custom.navigator === 'CustomAgent/2.0',
    custom
  );
  h.setProps({});
  await sleep(500);
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
  const kill = async (n: number) => {
    const before = h.events.gone.length;
    // The driver kills the page's renderer: `sandboxed_process` (adb root) on Android, WebContent on iOS.
    // (chrome://crash crashes a fresh renderer that never hosts the page, so WebView does not report it.)
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
    r.info('KILL', n);
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
  await sleep(500);
  await openPage(h, page);
  r.check('a setting applies before a crash', !!(await userAgent()));
  clearEvents(h);
  const firstKillAt = Date.now();
  const loadsBefore = h.events.loads.length;
  const countsBefore = h.events.pageCounts.length;
  const first = await kill(1);
  r.check('processGone reported and recovered', first?.recovered === true, first);
  r.check(
    'the page reloads',
    await waitFor(
      h,
      (s) => h.events.loads.slice(loadsBefore).includes('end') && s.url === page && idle(s),
      15000
    ),
    h.state()
  );
  // A page other than the source reloads its history entry in place: back still goes to the page before it, and
  // forward from there to it (Android restores the dead WebView's history into the new one). This is the second of
  // the crash loop's kills.
  const second = fresh(h, '/bridge.html');
  const loads = h.events.loads.length;
  await h.ref.current?.evaluate(`location.href = ${JSON.stringify(second)}`);
  await waitFor(
    h,
    (s) => h.events.loads.slice(loads).includes('end') && s.url === second && idle(s),
    15000
  );
  const reloads = h.events.loads.length;
  const killed = await kill(2);
  r.check(
    'a second page reloads in place, canGoBack unchanged',
    killed?.recovered === true &&
      (await waitFor(
        h,
        (s) =>
          h.events.loads.slice(reloads).includes('end') &&
          s.url === second &&
          idle(s) &&
          s.canGoBack,
        15000
      )),
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
  await sleep(1000);
  r.check(
    'the bridge works after recovery',
    (await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode)) === 4
  );
  // Android builds a new WebView on recovery: its settings must be applied again.
  r.check('the setting is still applied after recovery', !!(await userAgent()));

  const thirdLoads = h.events.loads.length;
  await kill(3);
  // The recovery reload ends first: before WebView 146 the state reads idle before it starts, and it would cut off
  // the navigation below.
  await waitFor(h, (s) => h.events.loads.slice(thirdLoads).includes('end') && idle(s), 15000);
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
  const retryLoads = h.events.loads.length;
  h.ref.current?.reload();
  r.check(
    'reload() brings the page back after giving up',
    (await waitFor(
      h,
      (s) => s.url === onScreen && idle(s) && h.events.loads.slice(retryLoads).includes('end'),
      15000
    )) && (await h.ref.current?.evaluate('location.href').catch(errorCode)) === onScreen,
    h.state()
  );
  r.check(
    'loading a new source works after giving up',
    await openPage(h, fresh(h, '/')),
    h.state()
  );
  r.check(
    'a new source resets the crash-loop guard',
    (await kill(5))?.recovered === true,
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
    (await kill(6))?.recovered === true,
    h.events.gone.at(-1)
  );
  r.check('the html source is shown again after recovery', await shown(), await marker());

  // A POST source on screen isn't sent again unasked (a payment form): recovery stops, and reload() sends it.
  const post = fresh(h, '/post');
  const body = `amount=9.99&t=${Date.now()}`;
  h.loadSource({ uri: post, body });
  await waitFor(h, (s) => s.url === post && idle(s));
  const postGone = await kill(7);
  r.check('a POST source is not sent again on recovery', postGone?.recovered === false, postGone);
  const postLoads = h.events.loads.length;
  h.ref.current?.reload();
  await waitFor(h, (s) => idle(s) && h.events.loads.slice(postLoads).includes('end'), 15000);
  r.check(
    'reload() sends the POST source after a crash',
    (await text(h, 'body')) === body,
    h.state()
  );
  r.done();
}

/** alert, confirm and prompt reach the user and their answers reach the page. The driver presses OK. */
async function dialogs(h: Harness) {
  const r = reporter('dialogs');
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
      : { android: { settings: { userAgentString: `${WebView.defaultUserAgent} Remounted/9` } } },
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
  await sleep(500);
  r.check(
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
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
    warn(...args);
  };
  const warned = (text: string) => warnings.some((line) => line.includes(text));
  const page = (expression: string) => h.ref.current?.evaluate(expression).catch(errorCode);
  const get = (key: string) => h.ref.current?.get(key).catch(errorCode);
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
      // The configuration key recreates the WebView, which reloads the page.
      await recreate(h, {
        ios: {
          configuration,
          preferences,
          scrollView: { nope: 1 },
          webView: { _private: 1, URL: 'x' },
        },
      });
      r.check('a WKPreferences number applies', (await fontSize()) === '30px', await fontSize());
      r.check(
        'an unknown property warns',
        warned('ios.scrollView.nope: no such property'),
        warnings
      );
      r.check('a private property warns', warned('ios.webView._private: private'), warnings);
      r.check('a read-only property warns', warned('ios.webView.URL: read-only'), warnings);
      // The same configuration from here on, so this is the same WebView.
      h.setProps({ ios: { configuration, preferences: { minimumFontSize: 'big' as never } } });
      await sleep(500);
      r.check(
        'a value of the wrong type warns',
        warned('ios.preferences.minimumFontSize:') && warned("can't take"),
        warnings
      );
      r.check('and leaves the property alone', (await fontSize()) === '30px', await fontSize());
      await openPage(h, fresh(h, '/ptr.html?mode=long'));
      h.setProps({
        ios: {
          configuration,
          scrollView: {
            contentInsetAdjustmentBehavior: WK.ContentInsetAdjustmentBehavior.never,
            contentOffset: { x: 0, y: 30 },
          },
        },
      });
      await sleep(500);
      r.check(
        'a UIScrollView struct applies',
        (await page('scrollY')) === 30,
        await page('scrollY')
      );
      const width = (await page('innerWidth')) as number;
      h.setProps({ ios: { configuration, webView: { pageZoom: 2 } } });
      await sleep(500);
      const zoomed = (await page('innerWidth')) as number;
      r.check('a WKWebView number applies', Math.abs(zoomed * 2 - width) <= 2, { width, zoomed });
      h.setProps({
        ios: {
          configuration,
          webpagePreferences: { preferredContentMode: WK.ContentMode.desktop },
        },
      });
      await sleep(500);
      await openPage(h, fresh(h, '/'));
      const desktop = await page('navigator.userAgent');
      r.check(
        'a WKWebpagePreferences enum applies from the next navigation',
        String(desktop).includes('Macintosh'),
        desktop
      );
      // get reads a property back; call: an NSHTTPCookie both ways, a void completion handler, valueError with NSData
      // and UIImage, value, a struct and a BOOL, refusals.
      h.setProps({
        ios: {
          configuration,
          scrollView: { bounces: false, contentInset: { top: 5, left: 0, bottom: 0, right: 0 } },
        },
      });
      await sleep(500);
      r.check('get reads a BOOL', (await get('scrollView.bounces')) === false);
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
        (await get('scrollView.nope')) === 'native_error'
      );
      const call = (
        method: string,
        args?: unknown[],
        options?: { completion?: 'void' | 'value' | 'valueError' | 'error' }
      ) => h.ref.current?.call(method, args, options).catch(errorCode);
      // The site data clear below removes this cookie.
      const value = String(Date.now());
      const setCookie = (cookie: Record<string, string>) =>
        call('httpCookieStore.setCookie:completionHandler:', [{ cookie }], { completion: 'void' });
      const stored = await setCookie({
        Name: 'mrwCall',
        Value: value,
        Domain: 'localhost',
        Path: '/',
      });
      const cookies = (await call('httpCookieStore.getAllCookies:', [], {
        completion: 'value',
      })) as { Name: string; Value: string }[] | string | undefined;
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
        [{ set: [WK.WebsiteDataType.cookies] }, { date: 0 }],
        { completion: 'void' }
      );
      r.check(
        'call clears site data (a void completion handler)',
        String(before).includes('mrw=1') &&
          cleared === null &&
          (await page('document.cookie')) === '',
        { before, cleared }
      );
      const pdf = await call('webView.createPDFWithConfiguration:completionHandler:', [null], {
        completion: 'valueError',
      });
      r.check(
        'call resolves NSData as base64 (valueError)',
        typeof pdf === 'string' && pdf.length > 100 && pdf.startsWith('JVBERi0'),
        String(pdf).slice(0, 20)
      );
      const png = await call('webView.takeSnapshotWithConfiguration:completionHandler:', [null], {
        completion: 'valueError',
      });
      r.check(
        'call resolves a UIImage as a PNG (valueError)',
        typeof png === 'string' && png.startsWith('iVBORw0KGgo'),
        String(png).slice(0, 20)
      );
      const records = await call(
        'websiteDataStore.fetchDataRecordsOfTypes:completionHandler:',
        [{ set: [WK.WebsiteDataType.localStorage] }],
        { completion: 'value' }
      );
      r.check('call resolves a value completion handler', Array.isArray(records), records);
      await page(`sessionStorage.setItem('mrw', '1')`);
      const session = await call(
        'webView.fetchDataOfTypes:completionHandler:',
        [WK.WebViewDataType.sessionStorage],
        { completion: 'valueError' }
      );
      const restored = await call('webView.restoreData:completionHandler:', [{ data: session }], {
        completion: 'error',
      });
      r.check(
        'call takes NSData and an error completion handler',
        typeof session === 'string' && session.length > 0 && restored === null,
        { session: String(session).slice(0, 12), restored }
      );
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
        'call rejects an unknown selector',
        (await call('webView.nope:', [1])) === 'native_error'
      );
      r.check(
        'call rejects a wrong argument count',
        (await call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }])) === 'native_error'
      );
    } else {
      const payment = () => page(`typeof PaymentRequest`);
      const paymentBefore = await payment();
      h.setProps({
        android: {
          settings: { minimumFontSize: 30, paymentRequestEnabled: true, nope: 1 },
          webView: { networkAvailable: false, _private: 1, webViewClient: null },
        },
      });
      await sleep(500);
      r.check('a WebSettings setter applies', (await fontSize()) === '30px', await fontSize());
      r.check('a WebView setter applies', (await page('navigator.onLine')) === false);
      await openPage(h, fresh(h, '/'));
      const paymentAfter = await payment();
      await checkUnlessOldWebView(
        h,
        r,
        'a setter only WebSettingsCompat has applies (through reflection on androidx, R8 included)',
        paymentBefore === 'undefined' && paymentAfter === 'function',
        { paymentBefore, paymentAfter }
      );
      r.check(
        'an unknown setter warns',
        warned('android.settings.nope: no public setter'),
        warnings
      );
      r.check(
        'a private key warns',
        warned('android.webView._private: not a public setter'),
        warnings
      );
      r.check(
        'a core-owned setter warns',
        warned('android.webView.webViewClient: owned by the core'),
        warnings
      );
      // The renderer process keeps navigator.onLine for later WebViews: put it back.
      h.setProps({
        android: {
          settings: { minimumFontSize: 'big' as never },
          webView: { networkAvailable: true },
        },
      });
      await sleep(500);
      r.check(
        'a value of the wrong type warns',
        warned('android.settings.minimumFontSize: no public setter takes a String'),
        warnings
      );
      r.check('and leaves the setting alone', (await fontSize()) === '30px', await fontSize());
      r.check('networkAvailable is restored', (await page('navigator.onLine')) === true);
      // get reads a setting back; call runs a public method of a root.
      r.check('get reads a WebSettings getter', (await get('settings.minimumFontSize')) === 30);
      await checkUnlessOldWebView(
        h,
        r,
        'get reads a WebSettingsCompat getter',
        (await get('settings.paymentRequestEnabled')) === true
      );
      r.check('get reads an is-getter', (await get('webView.verticalScrollBarEnabled')) === true);
      r.check('get rejects for an unknown key', (await get('settings.nope')) === 'native_error');
      const call = (method: string, args?: unknown[]) =>
        h.ref.current?.call(method, args).catch(errorCode);
      r.check('call runs a WebView method', (await call('webView.clearCache', [true])) === null);
      r.check('call returns the result', (await call('webView.getTitle')) === 'Test pages');
      r.check(
        'call rejects for a core-owned method',
        (await call('webView.destroy')) === 'native_error'
      );
      r.check(
        'get refuses a core-owned method, and the WebView still works',
        (await get('webView.destroy')) === 'native_error' && (await page('1+1')) === 2
      );
      await page(`(document.cookie = 'mrw=1; path=/')`);
      const before = await page('document.cookie');
      const removed = await call('cookieManager.removeAllCookies', [null]);
      await sleep(500);
      r.check(
        'call clears cookies through cookieManager',
        String(before).includes('mrw=1') &&
          removed === null &&
          (await page('document.cookie')) === '',
        { before, removed }
      );
      r.check('call reaches webStorage', (await call('webStorage.deleteAllData')) === null);
      r.check(
        'call rejects an unknown root',
        (await call('clearCache', [true])) === 'native_error'
      );
    }
  } finally {
    console.warn = warn;
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
  h.setProps({ onOpenExternal: (url) => external.push(url) });
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

  await click(h, 'tel');
  await waitFor(h, () => external.length > 0, 3000);
  r.check('tel: goes to onOpenExternal', external[0] === 'tel:+3725551234', external);
  r.check(
    'onNavigation reports the external decision and rule',
    lastNavigation()?.action === 'external' && lastNavigation()?.rule === 0,
    lastNavigation()
  );
  r.check('the page stays', h.state().url === page, h.state());

  await click(h, 'external');
  await waitFor(h, () => external.length > 1, 3000);
  r.check(
    'an outside main-frame link goes external',
    external[1] === 'https://example.com/',
    external
  );

  // Script-opened windows are off by default, so new windows come from a tap: a real one on Android (the harness asks
  // the driver), a click from evaluate on iOS (WebKit counts evaluate as a user gesture).
  const tap = async (id: string) => {
    if (Platform.OS !== 'android') {
      await click(h, id);
      return;
    }
    r.info('TAP', await tapPoint(h, id));
  };
  await tap('open');
  await waitFor(h, () => external.length > 2, 15000);
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

  await tap('blank');
  const inPlace = await waitFor(h, (s) => s.url.endsWith('/spa.html') && idle(s), 15000);
  r.check('a tapped target=_blank allowed by a newWindow rule loads in place', inPlace, h.state());

  // A window the page opens by itself (a timer, no gesture) opens only with javaScriptCanOpenWindowsAutomatically.
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
    onOpenExternal: (url) => external.push(url),
    ios: { preferences: { javaScriptCanOpenWindowsAutomatically: true } },
    android: { settings: { javaScriptCanOpenWindowsAutomatically: true } },
  });
  await sleep(500);
  h.loadSource(selfOpening('opted-in'));
  await waitFor(h, () => external.includes('https://example.com/opted-in'), 5000);
  r.check(
    'javaScriptCanOpenWindowsAutomatically lets it, through the newWindow rules',
    external.includes('https://example.com/opted-in'),
    external
  );
  await openPage(h, fresh(h, '/nav.html'));
  // A new window would load in the main frame, so a non-http(s) one is blocked before the rules (here the newWindow
  // `external` rule would match).
  const opener = h.state().url;
  await h.ref.current?.evaluate(`(window.open('data:text/html,opened'), true)`);
  const dataWindow = () =>
    h.events.navigations.find((n) => n.newWindow && n.url.startsWith('data:'));
  // Android's child WebView never reports a data: URL at all (Chromium doesn't pass it to shouldOverrideUrlLoading),
  // so there the proof is that nothing was allowed and nothing loaded; iOS reports the block.
  await waitFor(h, () => dataWindow() !== undefined, Platform.OS === 'ios' ? 5000 : 1500);
  await sleep(500);
  r.check(
    'a new window to a data: URL is blocked',
    Platform.OS === 'ios' ? dataWindow()?.action === 'block' : dataWindow()?.action !== 'allow',
    dataWindow()
  );
  r.check('the page stays after the blocked data: window', h.state().url === opener, h.state());
  // Android decides only navigations that start inside a frame with a user gesture, not the frame's initial src load:
  // a real tap on a link inside the iframe.
  if (Platform.OS === 'android') r.info('TAP', await tapPoint(h, 'redirect', 'frame'));
  else
    await h.ref.current?.evaluate(
      `document.getElementById('frame').contentDocument.getElementById('redirect').click()`
    );
  // Decisions about the iframe's navigation come before it moves (its redirect ends on /spa.html?from=redirect).
  const frameUrl = () =>
    h.ref.current?.evaluate(`document.getElementById('frame').contentWindow.location.href`);
  await until(
    async () => String(await frameUrl()?.catch(errorCode)).includes('from=redirect'),
    5000
  );
  await sleep(300);

  const frames = h.events.navigations.filter((n) => !n.mainFrame);
  // Android intercepts only non-http(s) iframe navigations (WebViewClient docs); iOS decides them all.
  if (Platform.OS === 'android')
    r.info('iframe decisions (http(s) iframes are not intercepted on Android)', frames.length);
  else
    r.check(
      'iframe navigations are decided as mainFrame false',
      frames.some((n) => n.action === 'allow'),
      frames.slice(0, 3)
    );

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
  await h.ref.current?.evaluate(`location.href = '/checkout/external'`);
  await decided('/checkout/external');
  r.check(
    'an ask answered external goes to onOpenExternal',
    lastNavigation()?.action === 'external' &&
      external.some((url) => url.endsWith('/checkout/external')),
    { navigation: lastNavigation(), external }
  );
  h.setAsk(() => 'deny' as unknown as 'block');
  await h.ref.current?.evaluate(`location.href = '/checkout/invalid'`);
  await decided('/checkout/invalid');
  r.check('an invalid ask answer blocks', lastNavigation()?.action === 'block', lastNavigation());
  r.check('the page stays after both', h.state().url === askedPage, h.state());

  // Without onOpenExternal native opens externals itself, and reports `block` when nothing can open the URL.
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

  if (Platform.OS === 'android') {
    // An intent: whose app is not installed falls back to the web.
    h.setProps({});
    h.setRules([
      { scheme: ['intent'], action: 'external' },
      { scheme: ['http', 'https'], action: 'allow' },
    ]);
    await sleep(500);
    const fallback = `${h.pages}/spa.html?from=fallback`;
    await h.ref.current?.evaluate(
      `location.href = 'intent://nothing/#Intent;scheme=nothere;package=com.example.notinstalled;S.browser_fallback_url=${encodeURIComponent(fallback)};end'`
    );
    r.check(
      'intent: without an app loads browser_fallback_url',
      await waitFor(h, (s) => s.url === fallback && idle(s), 8000),
      h.state()
    );
    // Nothing opened externally, so the intent: is reported as blocked; the fallback reports its own allow.
    const intent = h.events.navigations.find((n) => n.url.startsWith('intent:'));
    r.check('the intent: itself is reported as block', intent?.action === 'block', intent);
  }
  r.done();
}

/**
 * injectedScripts: run before page scripts, a DOMContentLoaded listener once the DOM is parsed, main frame only unless
 * mainFrameOnly is false, changes apply next load.
 */
async function injection(h: Harness) {
  const r = reporter('injection');
  h.setProps({
    injectedScripts: [
      { code: 'window.__injectedStart = true;', mainFrameOnly: false },
      { code: 'window.__mainOnly = true; window.__marker = "one";' },
      {
        code: `addEventListener('DOMContentLoaded', () => (window.__injectedEnd = !!document.getElementById('end')));`,
      },
    ],
  });
  await sleep(500);
  await openPage(h, fresh(h, '/injection.html'));
  await sleep(500);
  r.check('a script runs before page scripts', (await text(h, 'start')) === 'true');
  r.check(
    'its DOMContentLoaded listener runs once the DOM is parsed',
    (await text(h, 'end')) === 'true'
  );
  const frame = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return { start: w.__injectedStart === true, mainOnly: w.__mainOnly === true, top: window.__mainOnly === true };
  })()`)) as { start: boolean; mainOnly: boolean; top: boolean };
  r.check('a mainFrameOnly: false script runs in iframes', frame.start, frame);
  r.check('a script runs in the main frame only by default', frame.top && !frame.mainOnly, frame);
  h.setProps({ injectedScripts: [{ code: 'window.__marker = "two";' }] });
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

/** Downloads: an attachment, a blob: and a data: link all end in onDownload with a cache file and a sanitised filename;
 * on Android a blob above the size cap fails. */
async function downloadsSuite(h: Harness) {
  const r = reporter('downloads');
  await openPage(h, fresh(h, '/media.html'));
  // The attachment is fetched again on Android: the page's cookie must go with it.
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
    // Android before 146 reports no load for it: it never commits.
    if (id === 'attachment') {
      await waitFor(h, () => h.events.outcomes.length > outcomes, 2000);
      await checkUnlessOldWebView(
        h,
        r,
        'the attachment load ends as cancelled',
        h.events.outcomes.length === outcomes + 1 && h.events.outcomes[outcomes] === 'cancelled',
        h.events.outcomes.slice(outcomes)
      );
    }
    // Android's DownloadListener does not pass the link's `download` attribute: data:/blob: names are guessed.
    const nameOk =
      Platform.OS === 'android' && (id === 'blob' || id === 'data')
        ? download?.filename.endsWith('.txt')
        : download?.filename === filename;
    r.check(`${id} download reaches onDownload`, done && nameOk === true, download);
    const text = download?.uri.startsWith('file:') ? await new File(download.uri).text() : null;
    r.check(`${id} file holds the body`, text?.startsWith(body) === true, text?.slice(0, 80));
    if (id === 'attachment')
      r.check(
        'the attachment request carries the page cookie',
        text?.includes('dl=1') === true,
        text
      );
    // The server URL for http downloads; null when the page generated the file (data:, blob:).
    const url =
      id === 'attachment'
        ? attachmentUrl
        : id === 'moved'
          ? await h.ref.current?.evaluate("document.getElementById('moved').href")
          : null;
    r.check(
      `${id} download url is ${url === null ? 'null' : 'the full server URL'}`,
      download?.url === url,
      download?.url
    );
  }

  if (Platform.OS === 'android') {
    // Above Android's 100 MB cap a blob: download fails before the page reads it. The blob is made only here.
    const failures = h.events.downloadFailures.length;
    await h.ref.current?.evaluate(
      "(() => { const a = document.createElement('a'); a.id = 'bigblob'; a.download = 'big.bin'; a.href = URL.createObjectURL(new Blob([new Uint8Array(101 * 1024 * 1024)])); document.body.append(a); })()"
    );
    await click(h, 'bigblob');
    const failed = await waitFor(h, () => h.events.downloadFailures.length > failures, 20000);
    const failure = h.events.downloadFailures[failures];
    r.check(
      'a blob above the size cap reports a failure with a reason',
      failed && failure?.reason.includes('larger than') === true,
      failure
    );
  }

  // Without onDownload: http(s) opens externally (here onOpenExternal), data: and blob: are dropped. Then set again.
  const opened: string[] = [];
  h.setProps({ onDownload: undefined, onOpenExternal: (url) => opened.push(url) });
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
  r.done();
}

/** Camera and location reach the page only when onPermissionRequest says yes, main frame only; the OS allows it here. */
async function permissionsSuite(h: Harness) {
  const r = reporter('permissions');
  const asked: PermissionRequest[] = [];
  let answer = false;
  const handler = async (request: PermissionRequest) => {
    asked.push(request);
    return answer;
  };
  h.setPermission(handler);
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
    // WebView keeps a location answer for the page's lifetime: a new page asks the app again.
    await openPage(h, fresh(h, '/device.html'));
    answer = false;
    const geoDenied = await press('geo');
    r.check(
      'location denied when the app says no (PERMISSION_DENIED)',
      geoDenied.includes('geo error 1'),
      geoDenied
    );
  }

  // Another origin's frame, though the iframe allows the camera: denied without asking.
  await openPage(h, fresh(h, '/device.html'));
  answer = true;
  let askedBefore = asked.length;
  const framed =
    (
      await pageLog(h, () =>
        h.ref.current?.evaluate(
          `document.body.append(Object.assign(document.createElement('iframe'), { allow: 'camera', src: 'http://127.0.0.1:8090/device.html?auto=camera' }))`
        )
      )
    )?.join() ?? '';
  r.info('the cross-origin frame logged', framed);
  r.check(
    'a cross-origin frame is denied without asking',
    framed.includes('frame camera error') && asked.length === askedBefore,
    {
      framed,
      asked: asked.length - askedBefore,
    }
  );

  // A handler that never settles: the next page cancels its request (deny), aborts its signal and asks the app again.
  await openPage(h, fresh(h, '/device.html'));
  let release: (value: boolean) => void = () => {};
  let abortedAt = 0;
  h.setProps({
    onPermissionRequest: (request, signal) => {
      asked.push(request);
      signal.addEventListener('abort', () => (abortedAt = Date.now()));
      return new Promise<boolean>((resolve) => (release = resolve));
    },
  });
  await sleep(300);
  askedBefore = asked.length;
  await click(h, 'camera');
  await until(() => asked.length > askedBefore, 10000, 200);
  r.check(
    'a request whose handler never settles reaches JS',
    asked.length === askedBefore + 1,
    asked.length - askedBefore
  );
  h.setProps({});
  await sleep(300);
  const navigatedAt = Date.now();
  await openPage(h, fresh(h, '/device.html'));
  await until(() => abortedAt, 2000);
  r.check(
    "navigating away aborts the held handler's signal within 2 s",
    abortedAt > 0 && abortedAt - navigatedAt < 2000,
    abortedAt ? abortedAt - navigatedAt : 'not aborted'
  );
  answer = false;
  const again = await press('camera');
  r.check(
    'after navigating, the page asks again and gets the answer',
    asked.length === askedBefore + 2 && again.includes('NotAllowedError'),
    { asked: asked.length - askedBefore, again }
  );
  release(true);
  await sleep(300);
  r.check(
    'a late answer for the replaced page changes nothing',
    (await h.ref.current?.evaluate('1 + 1')) === 2
  );
  answer = true;

  if (Platform.OS === 'android') {
    // Without onPermissionRequest: denied. Set again: asked again, without a remount.
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

/** Android fullscreen: the page's fullscreen view shows, back leaves it. The driver taps and presses back. */
async function fullscreen(h: Harness) {
  const r = reporter('fullscreen');
  if (Platform.OS !== 'android') {
    r.info('skipped', 'WebKit provides fullscreen video itself');
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

  // Always on: without onFullscreenChange too. Nothing is reported; the page's fullscreenElement tells.
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
  const [gone, loads] = [h.events.gone.length, h.events.loads.length];
  r.info('KILL', 'in fullscreen');
  await waitFor(h, () => h.events.gone.length > gone, 15000);
  r.check(
    'a crash leaves fullscreen',
    await waitFor(h, () => h.events.fullscreen.at(-1) === false, 5000),
    h.events.fullscreen
  );
  // The recovery load: the state reads idle until it starts, so wait for its end event, as the crash suite does.
  await waitFor(
    h,
    (s) => h.events.loads.slice(loads).includes('end') && s.url.includes('/media.html') && idle(s),
    15000
  );
  r.done();
}

/** The out-of-package extension (example/modules/sample-extension) works through the public interface only. */
async function sampleExtension(h: Harness) {
  const r = reporter('sampleExtension');
  const before = h.events.pageCounts.length;
  h.events.hookEvents.length = 0;
  const page = fresh(h, '/spa.html');
  await openPage(h, page);
  await waitFor(h, () => h.events.pageCounts.at(-1)?.url === page, 5000);
  const event = h.events.pageCounts.at(-1);
  r.check(
    'its delegate gets a callback the core implements too, and emits through onHookEvent',
    h.events.pageCounts.length > before && event?.url === page,
    event
  );
  const inPage = (await h.ref.current?.evaluate('window.__pageCount')) as number;
  r.check('its native side reaches the page', inPage === event?.count, { inPage, event });
  r.check(
    'its onDocumentEnd handler hears the old page end',
    h.events.hookEvents.includes('pageCounter.documentEnd'),
    h.events.hookEvents
  );
  const count = await h.ref.current?.hook('pageCounter', 'count').catch(errorCode);
  r.check('ref.hook resolves with the reply of its handler', count === inPage, { count, inPage });
  const unhandled = [
    await h.ref.current?.hook('pageCounter', 'nope').catch(errorCode),
    await h.ref.current?.hook('noSuchHook', 'count').catch(errorCode),
  ];
  r.check(
    'ref.hook rejects with hook_not_handled when no attached hook handles the method',
    unhandled.every((code) => code === 'hook_not_handled'),
    unhandled
  );
  // A changed value reaches the attached hook (onOptionsChange), which stamps the page under the new name.
  const url = h.state().url;
  const loads = h.events.loads.length;
  await h.ref.current?.evaluate('window.__kept = true');
  h.setProps({ hookOptions: { pageCounter: { global: '__liveCount' } } });
  const live = await until(
    async () => (await h.ref.current?.evaluate('window.__liveCount')) === inPage,
    3000
  );
  const kept = await h.ref.current?.evaluate('window.__kept');
  r.check(
    'a hookOptions change reaches its hook live, without recreating the WebView or reloading the page',
    !!live && kept === true && h.state().url === url && h.events.loads.length === loads,
    { live, kept, url: h.state().url, newLoads: h.events.loads.length - loads }
  );
  h.setProps({});
  if (Platform.OS === 'ios') {
    h.load(`${h.pages}/redirect?to=${encodeURIComponent('/spa.html?from=hook')}`);
    await waitFor(h, (s) => s.url.includes('from=hook') && idle(s));
    r.check(
      'a callback the core does not implement is forwarded to its delegate (didReceiveServerRedirect)',
      await waitFor(h, () => h.events.hookEvents.includes('pageCounter.redirect'), 3000),
      h.events.hookEvents
    );
  } else {
    r.check(
      'a callback the core does not implement is forwarded to its client (onPageCommitVisible)',
      await waitFor(h, () => h.events.hookEvents.includes('pageCounter.commitVisible'), 3000),
      h.events.hookEvents
    );
  }
  // HTTP auth, which the core declines: the hook's delegate (client) answers it.
  await recreate(h, { hookOptions: { pageCounter: true, hookAuth: true } }, true);
  await openPage(h, fresh(h, '/auth?hook=1'));
  const auth = await text(h, 'auth');
  r.check('its delegate answers HTTP auth', auth === 'authorized', auth);
  // A dialog the core implements, taken over by a UI delegate (chrome client) through the context's list.
  await recreate(h, { hookOptions: { pageCounter: true, hookDialogs: true } }, true);
  h.events.hookEvents.length = 0;
  const after = await h.ref.current?.evaluate(`(alert('from the page'), 'after')`).catch(errorCode);
  // The event reaches JS on its own schedule, after the evaluate result at times.
  await until(() => h.events.hookEvents.includes('hookDialogs.alert'), 3000, 100);
  r.check(
    'its UI delegate takes over a dialog the core implements (alert), with no dialog shown',
    after === 'after' && h.events.hookEvents.includes('hookDialogs.alert'),
    { after, hookEvents: h.events.hookEvents }
  );
  await recreate(h, {}, true);
  if (Platform.OS === 'ios') {
    // configure() set data detectors before the WKWebView existed: WebKit turns the number into a tel: link.
    h.loadSource({ html: '<p id="n">Call 415-555-0134 today</p>', baseUrl: h.pages });
    const linked = async () =>
      (await h.ref.current?.evaluate("document.querySelector('#n a[href^=tel]') !== null")) ===
      true;
    r.check('its configure hook sets creation-time settings', !!(await until(linked, 5000, 250)));
  }
  r.done();
}

/** First-load headers, declined HTTP auth, shared cookies, download failures. */
async function network(h: Harness) {
  const r = reporter('network');

  const headersPage = fresh(h, '/headers');
  h.loadSource({ uri: headersPage, headers: { 'X-Test-Header': 'hello' } });
  await waitFor(h, (s) => s.url === headersPage && idle(s));
  r.check(
    'source.headers reach the first request',
    (await text(h, 'headers')).includes('"x-test-header":"hello"')
  );

  // Without a hook that answers it, HTTP auth is declined. Another origin: iOS reuses the credentials a hook gave for
  // localhost (sampleExtension), as browsers do.
  await openPage(h, fresh(h, 'http://127.0.0.1:8090/auth'));
  r.check(
    'HTTP auth without a hook shows the 401 page',
    (await text(h, 'auth')) === 'unauthorized',
    await text(h, 'auth')
  );

  // Native requests (RN fetch) and the WebView share cookies: both directions.
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

  const travel = async (
    name: string,
    go: () => void,
    url: string,
    title: string,
    back: boolean
  ) => {
    clearEvents(h);
    go();
    await waitFor(h, (s) => s.url === url && idle(s));
    await sleep(500); // a late state or load event would come now
    const shows = (await h.ref.current?.evaluate('window.shows')) as boolean[] | undefined;
    await checkUnlessOldWebView(
      h,
      r,
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
    r.check(`${name}: RN -> page call`, sum === 5, sum);
    h.bridge.emit('nativeEvent', { n: 7 });
    await until(
      async () =>
        ((await h.ref.current?.evaluate('window.lastEvent')) as { n?: number } | null)?.n === 7,
      3000
    );
    const event = await h.ref.current?.evaluate('window.lastEvent');
    r.check(`${name}: RN -> page event`, (event as { n?: number } | null)?.n === 7, event);
    await h.ref.current?.evaluate('window.lastEvent = null');
    const echo = await pageCall(h, 'echo', { url });
    r.check(
      `${name}: page -> RN call`,
      (echo.result as { url?: string } | undefined)?.url === url,
      echo
    );
  };
  await travel('back', () => h.ref.current?.goBack(), first, 'first', true);
  await travel('forward', () => h.ref.current?.goForward(), second, 'second', false);

  // A call still unanswered when its page goes into the cache rejects at once; the answer the page sends once restored
  // is dropped. Both ways: the page's call to the app's 'slow' (answered after 5 s) rejects in the page.
  await h.ref.current?.evaluate(`(() => {
    window.__straddle = undefined;
    nativeBridge.call('slow').then((result) => (window.__straddle = { result }), (error) => (window.__straddle = { error: error.code }));
  })()`);
  const inFlight = h.bridge.call('slow', { ms: 1500 }).then(
    (value) => ({ value, ms: Date.now() - left }),
    (error: unknown) => ({ code: errorCode(error), ms: Date.now() - left })
  );
  await sleep(200);
  const left = Date.now();
  h.ref.current?.goBack();
  const settled = await inFlight;
  r.check(
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
  await checkUnlessOldWebView(
    h,
    r,
    'a page -> RN call cut off by leaving the page rejects with navigated',
    straddle?.error === 'navigated',
    straddle
  );
  const after = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('the bridge works after the late answer', after === 2, after);

  // The rules still decide navigations the restored page starts.
  const asked = await allowAsks(h, [
    { path: ['/checkout'], action: 'ask' },
    { path: ['/blocked'], action: 'block' },
  ]);
  await h.ref.current?.evaluate(`location.href = '/blocked/page'`);
  await sleep(1000);
  r.check('a block rule holds on the restored page', h.state().url === second, h.state());
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

  const post = fresh(h, '/post');
  const body = `amount=9.99&t=${Date.now()}`;
  h.loadSource({ uri: post, body });
  await waitFor(h, (s) => s.url === post && idle(s));
  r.check(
    'source.body is sent as a form POST',
    (await text(h, 'body')) === body,
    await text(h, 'body')
  );
  // The page can't be fetched by URL: reload sends the POST again (Android's WebView would decline the resubmission).
  await h.ref.current?.evaluate(`document.getElementById('body').textContent = 'stale'`);
  const loads = h.events.loads.length;
  h.ref.current?.reload();
  await waitFor(h, () => h.events.loads.slice(loads).includes('end'));
  await sleep(300);
  r.check('reload sends the POST again', (await text(h, 'body')) === body, await text(h, 'body'));

  const dir = new Directory(Paths.cache, `site-${Date.now()}`);
  dir.create();
  await new File(dir, 'style.css').write('body { color: rgb(1, 2, 3) }');
  await new File(dir, 'app.js').write('window.__asset = 1');
  const index = new File(dir, 'index.html');
  await index.write(
    '<!doctype html><link rel="stylesheet" href="style.css"><script src="app.js"></script><p id="local">local</p>'
  );
  if (Platform.OS === 'android') h.setProps({ android: { settings: { allowFileAccess: true } } });
  h.loadSource({ uri: index.uri });
  await waitFor(h, (s) => s.url.endsWith('/index.html') && idle(s));
  const loaded = await h.ref.current?.evaluate(
    `[getComputedStyle(document.body).color, window.__asset, document.getElementById('local')?.textContent]`
  );
  r.check(
    'a file:// source loads with its own stylesheet and script',
    JSON.stringify(loaded) === JSON.stringify(['rgb(1, 2, 3)', 1, 'local']),
    { loaded, url: h.state().url }
  );
  dir.delete();
  r.done();
}

/** In run order: `maestro/run.sh` runs these keys when it is given no suites. */
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
  ptr,
  network,
  sources,
};
