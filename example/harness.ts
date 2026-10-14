// Scripted spike checks. Results go to the JS console as `[harness] PASS|FAIL|INFO ...` lines, readable from
// logcat (ReactNativeJS) or the Metro log, so no screenshots are needed.
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import type {
  Bridge,
  Download,
  DownloadFailure,
  FileRequest,
  NavigationEvent,
  NavigationRule,
  ProcessGoneEvent,
  PermissionRequestEvent,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  NavigationState,
  WebViewProps,
  WebViewRefObject,
  WebViewSource,
} from 'minimal-rn-webview';
import { WebView } from 'minimal-rn-webview';
import { AppState, Platform } from 'react-native';

export type Harness = {
  pages: string;
  platform: string;
  ref: WebViewRefObject;
  state: () => NavigationState;
  /** Remounts the WebView (a new `key`) without re-rendering App. */
  remount: () => void;
  load: (uri: string) => void;
  loadSource: (source: WebViewSource) => void;
  setAuth: (handler: WebViewProps['onHttpAuthRequest']) => void;
  setRules: (rules: NavigationRule[] | undefined) => void;
  setAsk: (ask: WebViewProps['onNavigationRequest']) => void;
  bridge: Bridge;
  /** Payloads of `pageEvent` events the page emitted. */
  pageEvents: unknown[];
  setFileRequest: (
    handler: ((request: FileRequest) => Promise<string[] | null>) | undefined
  ) => void;
  setPermission: (
    handler: ((request: PermissionRequestEvent) => Promise<boolean>) | undefined
  ) => void;
  /** Extra WebView props, replacing the previous extras. */
  setProps: (props: Partial<WebViewProps>) => void;
  /** What the WebView reported, in order. Suites clear what they read. */
  events: {
    errors: WebViewErrorEvent[];
    httpErrors: WebViewHttpErrorEvent[];
    gone: ProcessGoneEvent[];
    loads: string[];
    navigations: NavigationEvent[];
    downloads: Download[];
    downloadFailures: DownloadFailure[];
    fullscreen: boolean[];
    pageCounts: { url: string; count: number }[];
    /** Whether the example's renderError screen is mounted. */
    overlay: { error: boolean };
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let current: Harness | null = null;

function emit(line: string) {
  const text = `[harness ${current?.platform}] ${line}`;
  console.log(text);
  // A failed post surfaces as an unhandled rejection; the console line above still has the result.
  void fetch(`${current?.pages}/harness/log`, { method: 'POST', body: text });
}

/**
 * What the harness wants from an outside driver, shown on screen (testID `harness-request`) so a UI test tool can wait
 * for it: `<suite>#<n> <REQUEST> <detail>` for each request (upper-case `info` names), `<suite>#done pass=… fail=…` last.
 */
let showRequest: (text: string) => void = () => {};
export const onDriverRequest = (listener: (text: string) => void) => (showRequest = listener);

function reporter(suite: string) {
  let pass = 0;
  let fail = 0;
  let requests = 0;
  return {
    check(name: string, ok: boolean, detail: unknown = '') {
      ok ? pass++ : fail++;
      emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
    },
    info(name: string, detail: unknown) {
      if (/^[A-Z]+$/.test(name))
        showRequest(`${suite}#${++requests} ${name} ${JSON.stringify(detail)}`);
      emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
    },
    done() {
      showRequest(`${suite}#done pass=${pass} fail=${fail}`);
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
      showRequest(`${name}#done pass=? fail=1`);
      emit(`FAIL ${name}: threw ${String(error)}`);
      emit(`DONE ${name} pass=? fail=1`);
    } finally {
      busy = false;
    }
  }, 1000);
  return () => clearInterval(timer);
}

async function waitFor(h: Harness, predicate: (s: NavigationState) => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate(h.state())) return true;
    await sleep(50);
  }
  return false;
}

const idle = (s: NavigationState) => !s.loading && s.pendingUrl === null;
/** The height of a 100vh element: 0 when the WebView loaded the page before it had a size. */
const viewportHeight = async (h: Harness) =>
  (await h.ref.current?.evaluate(
    `(() => { const d = document.createElement('div'); d.style.height = '100vh'; document.body.append(d); const v = d.offsetHeight; d.remove(); return v; })()`
  )) as number;
const href = async (h: Harness) => (await h.ref.current?.evaluate('location.href')) as string;
const click = (h: Harness, id: string) =>
  h.ref.current?.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);

/** Committed url, getUrl() and the page's location.href all agree. */
async function agree(h: Harness, r: ReturnType<typeof reporter>, name: string) {
  await sleep(300); // let the coalesced state event arrive
  const page = await href(h);
  const native = await h.ref.current?.getUrl();
  const { url } = h.state();
  r.check(name, url === page && native === page, { url, getUrl: native, href: page });
}

async function urlTracking(h: Harness) {
  const r = reporter('urlTracking');
  // An app-started load is pending until it commits: never reported as the loaded, idle page before it starts. The
  // gap is widest right after launch (the web process is still starting), which is when this suite's first load runs.
  const first = `${h.pages}/spa.html?t=${Date.now()}`;
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
  r.check(
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

async function realSite(h: Harness) {
  const r = reporter('realSite');
  h.load('https://www.delfi.ee/');
  r.check(
    'delfi loads',
    await waitFor(h, (s) => s.url.includes('delfi.ee') && idle(s), 30000),
    h.state()
  );
  await agree(h, r, 'home agrees');
  for (let i = 0; i < 3; i++) {
    const before = h.state().url;
    // Click an internal article link so the Nuxt router navigates client-side.
    const target = await h.ref.current?.evaluate(`(() => {
      const a = [...document.querySelectorAll('a[href]')].find((a) => a.origin === location.origin && /\\/\\d{6,}/.test(a.pathname) && a.pathname !== location.pathname && !a.hash);
      if (!a) return null;
      a.click();
      return a.href;
    })()`);
    r.info(`click ${i}`, target);
    if (!target) break;
    r.check(
      `article ${i} changes url`,
      await waitFor(h, (s) => s.url !== before, 15000),
      h.state()
    );
    await waitFor(h, idle, 15000);
    await sleep(1500);
    await agree(h, r, `article ${i} agrees`);
  }
  h.ref.current?.goBack();
  await sleep(2500);
  await agree(h, r, 'goBack agrees');
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
    { host: ['localhost', 'www.delfi.ee'], path: ['/checkout', '/artikkel'], action: 'ask' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const start = `${h.pages}/nav.html?t=${Date.now()}`;
  h.load(start);
  await waitFor(h, (s) => s.url === start && idle(s));
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

  h.load('https://www.delfi.ee/');
  await waitFor(h, (s) => s.url.includes('delfi.ee') && idle(s), 30000);
  const article = await h.ref.current?.evaluate(`(() => {
    const a = [...document.querySelectorAll('a[href]')].find((a) => a.origin === location.origin && a.pathname.startsWith('/artikkel/') && !a.hash);
    if (!a) return null;
    a.click();
    return a.href;
  })()`);
  r.info('delfi article', article);
  r.check(
    'real site: an asked article link is reissued',
    await waitFor(h, (s) => s.url.includes('/artikkel/') && idle(s), 20000),
    { url: h.state().url, asked: asked.slice(-1) }
  );
  await sleep(1500);
  await agree(h, r, 'real site: url agrees after reissue');

  h.setRules(undefined);
  h.setAsk(undefined);
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
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    const outcome = await h.ref.current?.evaluate('window.__call');
    if (outcome) return outcome as { result?: unknown; error?: string };
    await sleep(100);
  }
  return { error: 'harness timeout' };
}

async function bridge(h: Harness) {
  const r = reporter('bridge');
  const page = `${h.pages}/bridge.html?t=${Date.now()}`;
  h.load(page);
  await waitFor(h, (s) => s.url === page && idle(s));
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
    'evaluate rejects ERR_EVALUATE on a throw, a rejection or a syntax error',
    thrown.every((c) => c === 'ERR_EVALUATE'),
    thrown
  );

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

  h.bridge.emit('nativeEvent', { n: 1 });
  await sleep(500);
  const logged = await h.ref.current?.evaluate(
    `window.testLog.some((line) => line.startsWith('nativeEvent'))`
  );
  r.check('RN -> page event', logged === true);
  const before = h.pageEvents.length;
  await h.ref.current?.evaluate(`nativeBridge.emit('pageEvent', { n: 2 })`);
  await sleep(500);
  r.check('page -> RN event', h.pageEvents.length === before + 1, h.pageEvents);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  const pending = evaluate('new Promise(() => {})')?.catch(errorCode);
  await sleep(200);
  h.load(`${page}&next=1`);
  r.check('navigation rejects calls in flight', (await inFlight) === 'navigated');
  const gone = await pending;
  r.check(
    'navigation rejects an evaluate in flight',
    gone === (Platform.OS === 'android' ? 'navigated' : 'ERR_EVALUATE'),
    gone
  );
  await waitFor(h, (s) => s.url.includes('next=1') && idle(s));
  await sleep(500);
  r.check(
    'the bridge works again after navigation',
    (await h.bridge.call('sum', { a: 1, b: 1 })) === 2
  );

  // PENDING on-device verification: a call made as the page commits waits for DOMContentLoaded, so the handler that
  // an inline script registers during load is there (not_found otherwise).
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

  const other = `http://127.0.0.1:8090/bridge.html?t=${Date.now()}`;
  h.load(other);
  await waitFor(h, (s) => s.url === other && idle(s));
  r.check(
    'no bridge for an origin outside allowedOrigins',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'undefined'
  );
  const blocked = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('calls to a disallowed page time out', blocked === 'timeout', blocked);
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
    const uri = `${h.pages}/ptr.html?mode=${mode}&t=${Date.now()}`;
    h.load(uri);
    await waitFor(h, (s) => s.url === uri && idle(s));
    await sleep(500);
  };
  const pull = async (kind: string) => {
    const before = await loadedAt();
    r.info('SWIPE', kind);
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      await sleep(250);
      if (idle(h.state()) && (await loadedAt()) !== before) return true;
    }
    return false;
  };

  await open('long');
  r.check('pull at the top of a long page reloads', await pull('full'));
  await open('short');
  r.check('pull on a short page reloads', await pull('full'));
  await open('long');
  await h.ref.current?.evaluate('window.scrollTo(0, 1500)');
  r.check('a short pull while scrolled down does not reload', !(await pull('short')));
  r.info('scrollY after the pull', await h.ref.current?.evaluate('window.scrollY'));
  await open('inner');
  await h.ref.current?.evaluate(`document.getElementById('scroller').scrollTop = 400`);
  r.check('a pull inside a scrolled inner scroller does not reload', !(await pull('inner')));

  // A reload that fails must end the refresh, or the control stays refreshing and ignores the next pull.
  h.setProps({ renderError: undefined });
  const key = Date.now();
  const dropping = `${h.pages}/drop?key=${key}`;
  h.load(dropping);
  await waitFor(h, (s) => s.url === dropping && idle(s));
  await sleep(500);
  clearEvents(h);
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  await pull('full');
  r.check(
    'a pull whose reload fails reports the error',
    await waitFor(h, () => h.events.errors.some((e) => e.kind === 'network'), 5000),
    h.events.errors
  );
  await fetch(`${h.pages}/drop/set?key=${key}&fail=0`);
  await sleep(1000);
  r.check('the next pull after a failed reload works', await pull('full'));
  h.setProps({});
  r.done();
}

/**
 * Android file chooser through onFileRequest: the app answers with URIs it got from an Expo API. Without the prop, the
 * system chooser. The taps come from outside (`INFO upload: TAP`), because WebView only opens choosers on a real gesture.
 */
async function upload(h: Harness) {
  const r = reporter('upload');
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
    const uri = `${h.pages}/upload.html?t=${Date.now()}`;
    h.load(uri);
    await waitFor(h, (s) => s.url === uri && idle(s));
    await sleep(500);
  };
  await open();
  const tapAndRead = async (label: string) => {
    const before = ((await h.ref.current?.evaluate('window.testLog.length')) as number) ?? 0;
    r.info('TAP', label);
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      await sleep(300);
      const lines = (await h.ref.current?.evaluate(`window.testLog.slice(${before})`)) as string[];
      if (lines.length) return lines.join(' | ');
    }
    return null;
  };

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
  for (const end = Date.now() + 10000; Date.now() < end && requests.length === held;)
    await sleep(200);
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
  h.setFileRequest(undefined);
  r.done();
}

const clearEvents = (h: Harness) => {
  h.events.errors.length = 0;
  h.events.httpErrors.length = 0;
  h.events.gone.length = 0;
  h.events.loads.length = 0;
};

async function openPage(h: Harness, uri: string, ms = 15000) {
  h.load(uri);
  const ok = await waitFor(h, (s) => s.url === uri && idle(s), ms);
  await sleep(300);
  return ok;
}

/** Main-frame errors only, the URL after a failure, onLoad vs onLoadEnd, and reload recovering. */
async function errors(h: Harness) {
  const r = reporter('errors');
  await openPage(h, `${h.pages}/?t=${Date.now()}`);

  clearEvents(h);
  const unreachable = 'http://localhost:8099/nothing'; // nothing listens there
  h.load(unreachable);
  const gotNetwork = await waitFor(h, () => h.events.errors.length > 0, 10000);
  await waitFor(h, idle, 5000);
  await sleep(500);
  const network = h.events.errors[0];
  r.check('network error', gotNetwork && network?.kind === 'network', network);
  r.check('url is the failed url', h.state().url === unreachable, h.state());
  r.check('getUrl is the failed url', (await h.ref.current?.getUrl()) === unreachable);
  r.check(
    'onLoadEnd without onLoad after a failure',
    h.events.loads.includes('end') && !h.events.loads.includes('load'),
    h.events.loads
  );

  clearEvents(h);
  h.load(`${h.pages}/status/404?t=${Date.now()}`);
  await waitFor(h, () => h.events.httpErrors.length > 0, 10000);
  const http = h.events.httpErrors[0];
  r.check('http error with the status code', http?.statusCode === 404, http);
  r.check('an http error is not an onError', h.events.errors.length === 0, h.events.errors);

  clearEvents(h);
  await openPage(h, `${h.pages}/subresource-404.html?t=${Date.now()}`);
  await sleep(1000);
  r.check(
    'subresource 404s are not reported',
    h.events.httpErrors.length === 0,
    h.events.httpErrors
  );
  r.check('onLoad after a clean load', h.events.loads.includes('load'), h.events.loads);

  clearEvents(h);
  h.load('https://expired.badssl.com/');
  const gotSsl = await waitFor(h, () => h.events.errors.length > 0, 20000);
  r.check('ssl error', gotSsl && h.events.errors[0]?.kind === 'ssl', h.events.errors[0]);

  clearEvents(h);
  const flaky = `${h.pages}/flaky?key=${Date.now()}`;
  h.load(flaky);
  await waitFor(h, () => h.events.httpErrors.length > 0 && idle(h.state()), 10000);
  r.check('503 reported', h.events.httpErrors[0]?.statusCode === 503, h.events.httpErrors[0]);
  h.events.loads.length = 0;
  h.ref.current?.reload();
  const reloaded = await waitFor(h, () => h.events.loads.includes('load'), 10000);
  r.check('reload after an error loads the page', reloaded && h.state().url === flaky, {
    loads: h.events.loads,
    state: h.state(),
  });
  r.check('the reload reports no new error', h.events.httpErrors.length === 1, h.events.httpErrors);
  r.done();
}

/** applicationNameForUserAgent appends to the default UA; userAgent replaces it. Both reach the server. */
async function ua(h: Harness) {
  const r = reporter('ua');
  const read = async () => {
    await openPage(h, `${h.pages}/ua?t=${Date.now()}`);
    return {
      header: (await h.ref.current?.evaluate(
        `document.getElementById('ua').textContent`
      )) as string,
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
  const page = `${h.pages}/bridge.html?t=${Date.now()}`;
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
    for (const end = Date.now() + 10000; Date.now() < end && !(await answers());) await sleep(300);
    r.info('KILL', n);
    await waitFor(h, () => h.events.gone.length > before, 15000);
    return h.events.gone[before];
  };
  await openPage(h, page);
  clearEvents(h);
  const firstKillAt = Date.now();
  const loadsBefore = h.events.loads.length;
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
  const recoveredVh = await viewportHeight(h);
  r.check('100vh has a height after recovery', recoveredVh > 0, recoveredVh);
  await sleep(1000);
  r.check(
    'the bridge works after recovery',
    (await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode)) === 4
  );
  // Android builds a new WebView on recovery: its settings must be applied again.
  const scrollbar =
    Platform.OS === 'ios'
      ? 'scrollView.showsVerticalScrollIndicator'
      : 'webView.verticalScrollBarEnabled';
  const showScrollbar = (shown: boolean) =>
    h.setProps(
      Platform.OS === 'ios'
        ? { ios: { scrollView: { showsVerticalScrollIndicator: shown } } }
        : { android: { webView: { verticalScrollBarEnabled: shown } } }
    );
  showScrollbar(false);
  await sleep(500);
  r.check(
    'a setting applies before a crash',
    (await h.ref.get(scrollbar).catch(errorCode)) === false
  );
  await kill(2);
  await sleep(1000);
  r.check(
    'the setting is still applied after recovery',
    (await h.ref.get(scrollbar).catch(errorCode)) === false
  );
  showScrollbar(true);
  await sleep(300);
  h.setProps({});

  for (const n of [3]) {
    await kill(n);
  }
  const fourth = await kill(4);
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
    'loading a new source works after giving up',
    await openPage(h, `${h.pages}/?t=${Date.now()}`),
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
  const shown = async () => {
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(300))
      if ((await marker()) === 'html source') return true;
    return false;
  };
  r.check('an html source is shown', await shown(), await marker());
  r.check(
    'processGone reported and recovered (html source)',
    (await kill(6))?.recovered === true,
    h.events.gone.at(-1)
  );
  r.check('the html source is shown again after recovery', await shown(), await marker());
  r.done();
}

/** alert, confirm and prompt reach the user and their answers reach the page. The driver presses OK. */
async function dialogs(h: Harness) {
  const r = reporter('dialogs');
  await openPage(h, `${h.pages}/dialogs.html?t=${Date.now()}`);
  for (const [id, expected] of [
    ['alert', 'alert closed'],
    ['confirm', 'confirm true'],
    ['prompt', 'prompt default'],
  ] as const) {
    const before = (await h.ref.current?.evaluate('window.testLog.length')) as number;
    // Ask for the press first and do not await: on iOS evaluate does not return while a dialog blocks the page.
    r.info('PRESS', 'OK');
    void h.ref.current?.evaluate(`setTimeout(() => document.getElementById('${id}').click(), 0)`);
    const end = Date.now() + 15000;
    let lines: string[] = [];
    while (Date.now() < end && !lines.length) {
      await sleep(300);
      lines = (await h.ref.current?.evaluate(`window.testLog.slice(${before})`)) as string[];
    }
    r.check(`${id} answered with OK`, lines.join() === expected, lines);
  }
  r.done();
}

async function info(h: Harness) {
  const r = reporter('info');
  const result = WebView.androidWebViewInfo;
  r.info('androidWebViewInfo', result);
  if (Platform.OS === 'ios') {
    r.check('null on iOS', result === null);
  } else {
    r.check(
      'provider available with a version',
      result?.available === true && /^\d+\./.test(result.version),
      result
    );
    r.check(
      'reports the features in use',
      Object.keys(result?.features ?? {}).length === 4,
      result?.features
    );
  }
  r.done();
}

/**
 * Settings fixed at mount (applicationNameForUserAgent): a change while mounted is ignored, on both platforms (with a
 * warning); a remount applies it, and afterwards the page, the bridge, the extensions and `ask` must all still work.
 */
async function mountSettings(h: Harness) {
  const r = reporter('mountSettings');
  const uaOf = async () => {
    await openPage(h, `${h.pages}/ua?t=${Date.now()}`);
    return (await h.ref.current?.evaluate(`document.getElementById('ua').textContent`)) as string;
  };
  const page = `${h.pages}/bridge.html?t=${Date.now()}`;
  await openPage(h, page);
  h.setProps({ applicationNameForUserAgent: 'Remounted/9' });
  await sleep(1000);
  r.check(
    'the page stays while a fixed setting changes',
    h.state().url === page && idle(h.state()),
    h.state()
  );
  const ignored = await uaOf();
  r.check('the change is ignored while mounted', !ignored.includes('Remounted/9'), ignored);
  h.remount();
  await sleep(500);
  await waitFor(h, idle, 10000);
  const remountedVh = await viewportHeight(h);
  r.check('100vh has a height after the remount', remountedVh > 0, remountedVh);
  const ua = await uaOf();
  r.check('the new app name is in the UA after a remount', ua.endsWith(' Remounted/9'), ua);
  await openPage(h, `${h.pages}/bridge.html?t=${Date.now()}`);
  await sleep(500);
  r.check(
    'the bridge works after the remount',
    (await h.bridge.call('sum', { a: 3, b: 4 }).catch(errorCode)) === 7
  );
  const asked: string[] = [];
  h.setAsk((request) => {
    asked.push(request.url);
    return 'allow';
  });
  h.setRules([
    { path: ['/checkout'], action: 'ask' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  await openPage(h, `${h.pages}/nav.html?t=${Date.now()}`);
  await click(h, 'checkout');
  const reached = await waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 8000);
  r.check('ask works after the remount', reached && asked.length > 0, { reached, asked });
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setProps({});
  await sleep(1500);
  r.done();
}

/** `ios` / `android` settings by name: applied live, read back with `get`, rejected with a warning when wrong. */
async function settings(h: Harness) {
  const r = reporter('settings');
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
    warn(...args);
  };
  const get = (key: string) => h.ref.get(key).catch(errorCode);
  const warned = (text: string) => warnings.some((line) => line.includes(text));
  try {
    await openPage(h, `${h.pages}/?t=${Date.now()}`);
    if (Platform.OS === 'ios') {
      h.setProps({
        ios: {
          scrollView: {
            bounces: false,
            contentInsetAdjustmentBehavior: 2,
            contentInset: { top: 5, left: 0, bottom: 0, right: 0 },
            nope: 1,
          },
          webView: { allowsBackForwardNavigationGestures: true, _private: 1, URL: 'x' },
          preferences: { minimumFontSize: 12 },
          configuration: { allowsInlineMediaPlayback: true },
        },
      });
      await sleep(500);
      r.check(
        'a BOOL applies',
        (await get('scrollView.bounces')) === false,
        await get('scrollView.bounces')
      );
      r.check(
        'an enum applies by raw value',
        (await get('scrollView.contentInsetAdjustmentBehavior')) === 2
      );
      const inset = (await get('scrollView.contentInset')) as Record<string, number> | undefined;
      r.check(
        'a struct applies and reads back',
        inset?.top === 5 && inset.left === 0 && inset.bottom === 0 && inset.right === 0,
        inset
      );
      r.check(
        'a WKWebView property applies',
        (await get('webView.allowsBackForwardNavigationGestures')) === true
      );
      r.check(
        'a WKPreferences property applies',
        (await get('preferences.minimumFontSize')) === 12
      );
      r.check(
        'an unknown property warns',
        warned('ios.scrollView.nope: no such property'),
        warnings
      );
      r.check('a private property warns', warned('ios.webView._private: private'), warnings);
      r.check('a read-only property warns', warned('ios.webView.URL: read-only'), warnings);
      r.check(
        'a configuration change while mounted warns',
        warned('ios.configuration.allowsInlineMediaPlayback: read once'),
        warnings
      );
      r.check(
        'get rejects for an unknown property',
        (await get('scrollView.nope')) === 'ERR_NATIVE'
      );
      r.check(
        'call is unavailable on iOS',
        (await h.ref.call('clearCache').catch(errorCode)) === 'unavailable'
      );
      h.setProps({ ios: { scrollView: { bounces: 'yes' as never } } });
      await sleep(500);
      r.check(
        'a value of the wrong type warns',
        warned('ios.scrollView.bounces:') && warned("can't take"),
        warnings
      );
      r.check('and leaves the property alone', (await get('scrollView.bounces')) === false);
      h.setProps({ ios: { configuration: { allowsInlineMediaPlayback: true } } });
      h.remount();
      await sleep(500);
      await waitFor(h, idle, 10000);
      r.check(
        'a configuration key applies when the WebView is created',
        (await get('configuration.allowsInlineMediaPlayback')) === true
      );
    } else {
      h.setProps({
        android: {
          settings: { textZoom: 120, algorithmicDarkeningAllowed: true, nope: 1 },
          webView: {
            overScrollMode: 2,
            verticalScrollBarEnabled: false,
            _private: 1,
            webViewClient: null,
          },
        },
      });
      await sleep(500);
      r.check(
        'a WebSettings setter applies',
        (await get('settings.textZoom')) === 120,
        await get('settings.textZoom')
      );
      r.check(
        'a WebSettingsCompat setter applies',
        (await get('settings.algorithmicDarkeningAllowed')) === true
      );
      r.check('a WebView setter applies', (await get('webView.overScrollMode')) === 2);
      r.check('an is-getter reads back', (await get('webView.verticalScrollBarEnabled')) === false);
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
      r.check('get rejects for an unknown key', (await get('settings.nope')) === 'ERR_NATIVE');
      r.check(
        'call runs a WebView method',
        (await h.ref.call('clearCache', true).catch(errorCode)) === null
      );
      r.check(
        'call returns the result',
        (await h.ref.call('getTitle').catch(errorCode)) === 'Test pages'
      );
      r.check(
        'call rejects for a core-owned method',
        (await h.ref.call('destroy').catch(errorCode)) === 'ERR_NATIVE'
      );
      h.setProps({ android: { settings: { textZoom: 'big' as never } } });
      await sleep(500);
      r.check(
        'a value of the wrong type warns',
        warned('android.settings.textZoom: no public setter takes a String'),
        warnings
      );
      r.check('and leaves the setting alone', (await get('settings.textZoom')) === 120);
    }
  } finally {
    console.warn = warn;
    // A new WebView: the keys above are not reset by their absence.
    h.setProps({});
    h.remount();
    await sleep(500);
    await waitFor(h, idle, 10000);
  }
  r.done();
}

/** renderError covers the WebView after a main-frame failure and goes away on the next load. */
async function overlays(h: Harness) {
  const r = reporter('overlays');
  clearEvents(h);
  h.load(`http://localhost:8099/nothing?t=${Date.now()}`);
  await waitFor(h, () => h.events.errors.length > 0, 10000);
  await sleep(800);
  r.check('renderError is shown after a failure', h.events.overlay.error);
  await openPage(h, `${h.pages}/?t=${Date.now()}`);
  await sleep(800);
  r.check('renderError goes away on the next load', !h.events.overlay.error);
  r.done();
}

/** Rules, new windows, external links handed to JS, iframes, intent fallbacks and the ask redirect-loop guard. */
async function navigation(h: Harness) {
  const r = reporter('navigation');
  const external: string[] = [];
  const asked: string[] = [];
  const lastNavigation = () => h.events.navigations[h.events.navigations.length - 1];
  h.setProps({ onOpenExternal: (url) => external.push(url) });
  h.setAsk((request) => {
    asked.push(request.url);
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
  const page = `${h.pages}/nav.html?t=${Date.now()}`;
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
    const point = (await h.ref.current?.evaluate(`(() => {
      const e = document.getElementById(${JSON.stringify(id)}); e.scrollIntoView({ block: 'center' });
      const b = e.getBoundingClientRect(), d = devicePixelRatio;
      return [Math.round((b.left + b.width / 2) * d), Math.round((50 + b.top + b.height / 2) * d)];
    })()`)) as [number, number];
    r.info('TAP', point.join(' '));
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
    html: `<script>setTimeout(() => window.open('https://example.com/${name}'), 300)</script>`,
    baseUrl: h.pages,
  });
  h.loadSource(selfOpening('blocked'));
  await sleep(2500);
  r.check(
    'by default a script cannot open a window without a gesture',
    !external.includes('https://example.com/blocked'),
    external
  );
  h.setProps({
    onOpenExternal: (url) => external.push(url),
    javaScriptCanOpenWindowsAutomatically: true,
  });
  await sleep(500);
  h.loadSource(selfOpening('opted-in'));
  await waitFor(h, () => external.includes('https://example.com/opted-in'), 5000);
  r.check(
    'javaScriptCanOpenWindowsAutomatically lets it, through the newWindow rules',
    external.includes('https://example.com/opted-in'),
    external
  );
  await openPage(h, `${h.pages}/nav.html?t=${Date.now()}`);
  // Android decides only navigations that start inside a frame with a user gesture, not the frame's initial src load:
  // a real tap on a link inside the iframe.
  const inFrame = (await h.ref.current?.evaluate(`(() => {
    const f = document.getElementById('frame'); f.scrollIntoView({ block: 'center' });
    const a = f.contentDocument.getElementById('redirect');
    const fr = f.getBoundingClientRect(), ar = a.getBoundingClientRect(), d = devicePixelRatio;
    return [Math.round((fr.left + ar.left + 8) * d), Math.round((50 + fr.top + ar.top + ar.height / 2) * d)];
  })()`)) as [number, number];
  if (Platform.OS === 'android') r.info('TAP', inFrame.join(' '));
  else
    await h.ref.current?.evaluate(
      `document.getElementById('frame').contentDocument.getElementById('redirect').click()`
    );
  await sleep(2500);

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
  await sleep(5000);
  r.check(
    'an ask redirect loop asks at most once per URL',
    asked.length >= 1 && asked.length <= 2,
    asked
  );
  await openPage(h, `${h.pages}/nav.html?t=${Date.now()}`);

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
  }
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setProps({});
  await sleep(500);
  r.done();
}

/**
 * injectedScripts: start runs before page scripts, end after the DOM, mainFrameOnly skips iframes, changes apply next
 * load. Android WebView older than 146 skips end scripts.
 */
async function injection(h: Harness) {
  const r = reporter('injection');
  const canEnd = WebView.androidWebViewInfo?.features.JS_INJECTION_IN_FRAME_AND_WORLD !== false;
  h.setProps({
    injectedScripts: [
      { code: 'window.__injectedStart = true;', when: 'start' },
      {
        code: 'window.__mainOnly = true; window.__marker = "one";',
        when: 'start',
        mainFrameOnly: true,
      },
      { code: 'window.__injectedEnd = true;', when: 'end', mainFrameOnly: true },
    ],
  });
  await sleep(500);
  await openPage(h, `${h.pages}/injection.html?t=${Date.now()}`);
  await sleep(500);
  const text = async (id: string) =>
    (await h.ref.current?.evaluate(`document.getElementById('${id}').textContent`)) as string;
  r.check('a start script runs before page scripts', (await text('start')) === 'true');
  if (canEnd) r.check('an end script runs by load', (await text('end')) === 'true');
  else
    r.check(
      'an end script is skipped below WebView 146',
      (await h.ref.current?.evaluate('window.__injectedEnd')) == null
    );
  const frame = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return { start: w.__injectedStart === true, mainOnly: w.__mainOnly === true, top: window.__mainOnly === true };
  })()`)) as { start: boolean; mainOnly: boolean; top: boolean };
  r.check('a start script without mainFrameOnly runs in iframes', frame.start, frame);
  r.check(
    'a mainFrameOnly script runs in the main frame and skips iframes',
    frame.top && !frame.mainOnly,
    frame
  );
  h.setProps({ injectedScripts: [{ code: 'window.__marker = "two";', when: 'start' }] });
  await sleep(500);
  r.check(
    'a changed script waits for the next navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'one'
  );
  await openPage(h, `${h.pages}/injection.html?t=${Date.now()}`);
  r.check(
    'the changed script applies after navigation',
    (await h.ref.current?.evaluate('window.__marker')) === 'two'
  );
  r.check('the removed script is gone', (await text('start')) === 'false');
  r.check(
    'the bridge page client still installs',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'object'
  );
  h.setProps({});
  await sleep(500);
  r.done();
}

/** Downloads: an attachment, a blob: and a data: link all end in onDownload with a cache file and a sanitised filename. */
async function downloadsSuite(h: Harness) {
  const r = reporter('downloads');
  await openPage(h, `${h.pages}/media.html?t=${Date.now()}`);
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
    const before = h.events.downloads.length;
    await click(h, id);
    const done = await waitFor(h, () => h.events.downloads.length > before, 20000);
    const download = h.events.downloads[before];
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
  const asked: PermissionRequestEvent[] = [];
  let answer = false;
  const handler = async (request: PermissionRequestEvent) => {
    asked.push(request);
    return answer;
  };
  h.setPermission(handler);
  const press = async (id: string) => {
    const before = (await h.ref.current?.evaluate('window.testLog.length')) as number;
    await click(h, id);
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      await sleep(300);
      const lines = (await h.ref.current?.evaluate(`window.testLog.slice(${before})`)) as string[];
      if (lines.length) return lines.join();
    }
    return 'no result';
  };
  await openPage(h, `${h.pages}/device.html?t=${Date.now()}`);
  answer = false;
  const denied = await press('camera');
  r.check('the app saying no denies the camera', denied.includes('NotAllowedError'), denied);
  r.check(
    'the request names origin and resource',
    asked[0]?.origin === h.pages && asked[0].resources.includes('camera'),
    asked[0]
  );

  r.info('GRANT', 'camera location');
  await sleep(3000);
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
    await openPage(h, `${h.pages}/device.html?t=${Date.now()}`);
    answer = false;
    const geoDenied = await press('geo');
    r.check(
      'location denied when the app says no (PERMISSION_DENIED)',
      geoDenied.includes('geo error 1'),
      geoDenied
    );
  }

  // Another origin's frame, though the iframe allows the camera: denied without asking.
  await openPage(h, `${h.pages}/device.html?t=${Date.now()}`);
  answer = true;
  let askedBefore = asked.length;
  const before = (await h.ref.current?.evaluate('window.testLog.length')) as number;
  await h.ref.current?.evaluate(
    `document.body.append(Object.assign(document.createElement('iframe'), { allow: 'camera', src: 'http://127.0.0.1:8090/device.html?auto=camera' }))`
  );
  let framed = '';
  for (const end = Date.now() + 10000; Date.now() < end && !framed; await sleep(300)) {
    framed =
      ((await h.ref.current?.evaluate(`window.testLog.slice(${before}).join()`)) as string) ?? '';
  }
  r.info('the cross-origin frame logged', framed);
  r.check(
    'a cross-origin frame is denied without asking',
    framed.includes('frame camera error') && asked.length === askedBefore,
    {
      framed,
      asked: asked.length - askedBefore,
    }
  );

  // A handler that never settles: the next page cancels its request (deny) and asks the app again.
  await openPage(h, `${h.pages}/device.html?t=${Date.now()}`);
  let release: (value: boolean) => void = () => {};
  h.setPermission((request) => {
    asked.push(request);
    return new Promise<boolean>((resolve) => (release = resolve));
  });
  askedBefore = asked.length;
  await click(h, 'camera');
  for (const end = Date.now() + 10000; Date.now() < end && asked.length === askedBefore;)
    await sleep(200);
  r.check(
    'a request whose handler never settles reaches JS',
    asked.length === askedBefore + 1,
    asked.length - askedBefore
  );
  h.setPermission(handler);
  await openPage(h, `${h.pages}/device.html?t=${Date.now()}`);
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
  h.setPermission(undefined);
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
  await openPage(h, `${h.pages}/media.html?t=${Date.now()}`);
  h.events.fullscreen.length = 0;
  // Screen pixels for the driver: the WebView starts 50 dp from the top of the screen (the example's padding).
  const fullscreenPoint = async () =>
    (await h.ref.current?.evaluate(`(() => {
      const b = document.getElementById('fullscreen'); b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(), d = devicePixelRatio;
      return [Math.round((r.left + r.width / 2) * d), Math.round((50 + r.top + r.height / 2) * d)];
    })()`)) as [number, number];
  r.info('TAP', (await fullscreenPoint()).join(' '));
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
  const until = async (want: boolean) => {
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(300))
      if ((await active()) === want) return true;
    return false;
  };
  r.info('TAP', (await fullscreenPoint()).join(' '));
  const entered = await until(true);
  r.check('fullscreen works without onFullscreenChange', entered);
  if (entered) {
    r.info('BACK', 'leave');
    r.check('back leaves it', await until(false));
  }
  h.setProps({});
  r.done();
}

/** The out-of-package extension (example/modules/sample-extension) works through the public interface only. */
async function sampleExtension(h: Harness) {
  const r = reporter('sampleExtension');
  const before = h.events.pageCounts.length;
  const page = `${h.pages}/spa.html?t=${Date.now()}`;
  await openPage(h, page);
  await sleep(1000);
  const event = h.events.pageCounts.at(-1);
  r.check(
    'its native side emits through the generic channel',
    h.events.pageCounts.length > before && event?.url === page,
    event
  );
  const inPage = (await h.ref.current?.evaluate('window.__pageCount')) as number;
  r.check('its native side reaches the page', inPage === event?.count, { inPage, event });
  if (Platform.OS === 'ios') {
    // configure() set data detectors before the WKWebView existed: WebKit turns the number into a tel: link.
    h.loadSource({ html: '<p id="n">Call 415-555-0134 today</p>', baseUrl: h.pages });
    const linked = async () =>
      (await h.ref.current?.evaluate("document.querySelector('#n a[href^=tel]') !== null")) ===
      true;
    let ok = false;
    for (const end = Date.now() + 5000; Date.now() < end && !(ok = await linked());)
      await sleep(250);
    r.check('its configure hook sets creation-time settings', ok);
  }
  r.done();
}

/** First-load headers, HTTP auth, shared cookies, download failures, HTTP error pages. */
async function network(h: Harness) {
  const r = reporter('network');
  const text = async (id: string) =>
    (await h.ref.current?.evaluate(
      `document.getElementById('${id}')?.textContent ?? ''`
    )) as string;

  const headersPage = `${h.pages}/headers?t=${Date.now()}`;
  h.loadSource({ uri: headersPage, headers: { 'X-Test-Header': 'hello' } });
  await waitFor(h, (s) => s.url === headersPage && idle(s));
  r.check(
    'source.headers reach the first request',
    (await text('headers')).includes('"x-test-header":"hello"')
  );

  // Answered late: the challenge's own page load must not cancel it (pending asks end when a new page commits).
  let authAsks = 0;
  h.setAuth(async () => {
    authAsks++;
    await sleep(1500);
    return { username: 'u', password: 'p' };
  });
  await openPage(h, `${h.pages}/auth?t=${Date.now()}`);
  r.check(
    'onHttpAuthRequest credentials authorize the page',
    (await text('auth')) === 'authorized',
    await text('auth')
  );
  r.check(
    'a late auth answer is not cancelled by its own page load',
    authAsks === 1 && (await text('auth')) === 'authorized',
    authAsks
  );
  h.setAuth(() => null);
  // Another origin: the WebView caches the credentials it just used for localhost's realm, as browsers do.
  await openPage(h, `http://127.0.0.1:8090/auth?t=${Date.now()}`);
  r.check(
    'onHttpAuthRequest null cancels (the 401 page shows)',
    (await text('auth')) === 'unauthorized',
    await text('auth')
  );
  let asks = 0;
  h.setAuth(() => {
    asks++;
    return null;
  });
  await openPage(h, `${h.pages}/auth2?t=${Date.now()}`);
  r.check(
    'a decline asks once when the server offers Digest and Basic',
    asks === 1 && (await text('auth')) === 'unauthorized',
    asks
  );
  // Wrong credentials every time: asked three times (the first answer and two retries), then the 401 page shows.
  let wrongAsks = 0;
  h.setAuth(() => {
    wrongAsks++;
    return { username: 'u', password: 'wrong' };
  });
  await openPage(h, `http://127.0.0.1:8090/auth?wrong=1&t=${Date.now()}`);
  r.check(
    'wrong credentials are retried at most 3 times',
    wrongAsks === 3 && (await text('auth')) === 'unauthorized',
    wrongAsks
  );
  h.setAuth(undefined);

  clearEvents(h);
  await openPage(h, `${h.pages}/status/404?t=${Date.now()}`);
  await sleep(800);
  r.check(
    'an HTTP 404 reports onHttpError',
    h.events.httpErrors.some((e) => e.statusCode === 404),
    h.events.httpErrors
  );
  r.check('an HTTP 404 does not show renderError', !h.events.overlay.error);

  // Native requests (RN fetch) and the WebView share cookies: both directions.
  await fetch(`${h.pages}/setcookie?name=fromNative&value=${Date.now()}`);
  await openPage(h, `${h.pages}/cookies?t=${Date.now()}`);
  r.check(
    'a cookie set by a native request reaches the page',
    (await text('cookies')).includes('fromNative='),
    await text('cookies')
  );
  await h.ref.current?.evaluate(`document.cookie = 'fromPage=${Date.now()}; path=/'`);
  await sleep(1500);
  const native = await fetch(`${h.pages}/cookies`).then((res) => res.text());
  r.check(
    'a cookie set by the page reaches native requests',
    native.includes('fromPage='),
    native.slice(0, 200)
  );
  h.setProps({});
  await sleep(1000);

  if (Platform.OS === 'android') {
    await openPage(h, `${h.pages}/media.html?t=${Date.now()}`);
    const before = h.events.downloadFailures.length;
    await click(h, 'baddata');
    // Chromium may reject a malformed data: URL before the download listener runs; either way the app survives.
    await waitFor(h, () => h.events.downloadFailures.length > before, 5000);
    r.info('invalid data: download failures reported', h.events.downloadFailures.slice(before));
    r.check(
      'the app survives an invalid data: download',
      (await h.ref.current?.evaluate('1 + 1')) === 2
    );
  }
  r.done();
}

/** The bridge after going back to a page, which WebKit (and Android with BFCache on) may restore without reloading it. */
async function backForward(h: Harness) {
  const r = reporter('backForward');
  const page = `${h.pages}/back-forward.html?t=${Date.now()}`;
  await openPage(h, page);
  // A page call still waiting (the app answers 'slow' after 5 s) when the page is left: the answer can't reach it.
  await h.ref.current?.evaluate(`(() => {
    window.__straddle = undefined;
    nativeBridge.call('slow').then((result) => (window.__straddle = { result }), (error) => (window.__straddle = { error: error.code }));
  })()`);
  await openPage(h, `${h.pages}/spa.html?t=${Date.now()}`);
  h.ref.current?.goBack();
  await waitFor(h, (s) => s.url === page && idle(s));
  await sleep(500);
  const shows = (await h.ref.current?.evaluate('window.shows')) as boolean[] | undefined;
  r.info('pageshow persisted flags', { shows });
  const straddle = (await h.ref.current?.evaluate('window.__straddle')) as
    { error?: string } | null | undefined;
  r.check(
    'a page call cut off by leaving the page fails with navigated',
    !shows?.[1] || straddle?.error === 'navigated',
    straddle
  );
  const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
  r.check('RN -> page call after going back', sum === 5, sum);
  h.bridge.emit('nativeEvent', { n: 7 });
  await sleep(500);
  const event = await h.ref.current?.evaluate('window.lastEvent');
  r.check('RN -> page event after going back', (event as { n?: number } | null)?.n === 7, event);
  const echo = await pageCall(h, 'echo', { back: true });
  r.check(
    'page -> RN call after going back',
    (echo.result as { back?: boolean } | undefined)?.back === true,
    echo
  );
  r.done();
}

export const SUITES: Record<string, (h: Harness) => Promise<void>> = {
  urlTracking,
  realSite,
  reissue,
  bridge,
  backForward,
  ptr,
  upload,
  errors,
  ua,
  crash,
  dialogs,
  info,
  mountSettings,
  settings,
  overlays,
  navigation,
  injection,
  downloads: downloadsSuite,
  permissions: permissionsSuite,
  fullscreen,
  sampleExtension,
  network,
};
