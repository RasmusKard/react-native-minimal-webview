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
  NavigationState,
  WebViewProps,
  WebViewRef,
  WebViewSource,
} from 'minimal-rn-webview';
import type { RefObject } from 'react';
import { WebView } from 'minimal-rn-webview';
import { Platform } from 'react-native';

import type { RnwDriver } from './parity';

export type Harness = {
  pages: string;
  platform: string;
  ref: RefObject<WebViewRef | null>;
  state: () => NavigationState;
  load: (uri: string) => void;
  loadSource: (source: WebViewSource) => void;
  setAuth: (handler: ((request: { host: string; realm: string }) => { username: string; password: string } | null) | undefined) => void;
  setRules: (rules: NavigationRule[] | undefined) => void;
  setAsk: (ask: WebViewProps['onNavigationRequest']) => void;
  bridge: Bridge;
  /** Payloads of `pageEvent` events the page emitted. */
  pageEvents: unknown[];
  setFileRequest: (handler: ((request: FileRequest) => Promise<string[] | null>) | undefined) => void;
  setPermission: (handler: ((request: PermissionRequestEvent) => Promise<boolean>) | undefined) => void;
  /** Mounts a fresh WebView of that kind over the screen; resolves with ms from request to first onLoadEnd. */
  measureLoad: (kind: 'minimal' | 'rnw', uri: string) => Promise<{ ms: number; readyState: string }>;
  endPerf: () => void;
  /** A react-native-webview instance for parity checks (example/parity.tsx). */
  rnw: () => RnwDriver;
  showRnw: (source: { uri: string }) => void;
  hideRnw: () => void;
  /** Extra WebView props, replacing the previous extras. */
  setProps: (props: Partial<WebViewProps>) => void;
  /** What the WebView reported, in order. Suites clear what they read. */
  events: {
    errors: WebViewErrorEvent[];
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

function reporter(suite: string) {
  let pass = 0;
  let fail = 0;
  return {
    check(name: string, ok: boolean, detail: unknown = '') {
      ok ? pass++ : fail++;
      emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
    },
    info(name: string, detail: unknown) {
      emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
    },
    done() {
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
    if (suite) await suite(current);
    else emit(`FAIL unknown suite ${name}`);
    busy = false;
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
  h.load(`${h.pages}/spa.html?t=${Date.now()}`);
  r.check(
    'initial load',
    await waitFor(h, (s) => s.url.includes('/spa.html') && idle(s)),
    h.state()
  );
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
    r.check('iframe navigations into an ask rule are blocked without asking', asked.length === beforeFrame, asked);
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

/** Starts a page-side `nativeBridge.call` and waits for its outcome (Android's evaluate cannot await). */
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
  r.check(
    'page sees window.nativeBridge',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'object'
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
  await sleep(200);
  h.load(`${page}&next=1`);
  r.check('navigation rejects calls in flight', (await inFlight) === 'navigated');
  await waitFor(h, (s) => s.url.includes('next=1') && idle(s));
  await sleep(500);
  r.check(
    'the bridge works again after navigation',
    (await h.bridge.call('sum', { a: 1, b: 1 })) === 2
  );

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
 * Pull-to-refresh through the extension hooks. The gesture comes from outside the app: the suite logs
 * `INFO ptr: SWIPE "<kind>"` and the driver (adb input swipe / agent-device swipe) performs it.
 */
async function ptr(h: Harness) {
  const r = reporter('ptr');
  const loadedAt = async () => (await h.ref.current?.evaluate(`document.getElementById('loaded').textContent`)) as string;
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
  r.done();
}

/**
 * Android file chooser through the fileUpload extension: the app answers with URIs it got from an Expo API.
 * The tap comes from outside (`INFO upload: TAP`), because WebView only opens choosers on a real gesture.
 */
async function upload(h: Harness) {
  const r = reporter('upload');
  const file = new File(Paths.cache, 'upload-test.txt');
  file.create({ overwrite: true });
  file.write('hello from the app cache');
  const requests: FileRequest[] = [];
  let answer: string[] | null = null;
  h.setFileRequest(async (request) => {
    requests.push(request);
    return answer;
  });
  const uri = `${h.pages}/upload.html?t=${Date.now()}`;
  h.load(uri);
  await waitFor(h, (s) => s.url === uri && idle(s));
  await sleep(500);
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
    requests[0]?.accept.join() === 'text/plain,image/*' && requests[0].multiple === false && requests[0].capture === false,
    requests[0]
  );

  answer = [await getContentUriAsync(file.uri)];
  const fromContentUri = await tapAndRead('content uri');
  r.info('content:// URI', answer[0]);
  r.check('a content:// URI (FileProvider) uploads', fromContentUri?.includes('hello from the app cache') ?? false, fromContentUri);

  answer = null;
  const cancelled = await tapAndRead('cancel');
  r.info('after cancel the page logged', cancelled);
  answer = [file.uri];
  const again = await tapAndRead('after cancel');
  r.check('the chooser opens again after a cancel (callback called once)', again?.includes('hello') ?? false, again);
  h.setFileRequest(undefined);
  r.done();
}

const clearEvents = (h: Harness) => {
  h.events.errors.length = 0;
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
  r.check('network error', gotNetwork && network?.kind === 'network' && network.isMainFrame, network);
  r.check('url is the failed url', h.state().url === unreachable, h.state());
  r.check('getUrl is the failed url', (await h.ref.current?.getUrl()) === unreachable);
  r.check('onLoadEnd without onLoad after a failure', h.events.loads.includes('end') && !h.events.loads.includes('load'), h.events.loads);

  clearEvents(h);
  h.load(`${h.pages}/status/404?t=${Date.now()}`);
  await waitFor(h, () => h.events.errors.length > 0, 10000);
  const http = h.events.errors[0];
  r.check('http error with the status code', http?.kind === 'http' && http.code === 404, http);

  clearEvents(h);
  await openPage(h, `${h.pages}/subresource-404.html?t=${Date.now()}`);
  await sleep(1000);
  r.check('subresource 404s are not reported', h.events.errors.length === 0, h.events.errors);
  r.check('onLoad after a clean load', h.events.loads.includes('load'), h.events.loads);

  clearEvents(h);
  h.load('https://expired.badssl.com/');
  const gotSsl = await waitFor(h, () => h.events.errors.length > 0, 20000);
  r.check('ssl error', gotSsl && h.events.errors[0]?.kind === 'ssl', h.events.errors[0]);

  clearEvents(h);
  const flaky = `${h.pages}/flaky?key=${Date.now()}`;
  h.load(flaky);
  await waitFor(h, () => h.events.errors.length > 0 && idle(h.state()), 10000);
  r.check('503 reported', h.events.errors[0]?.code === 503, h.events.errors[0]);
  h.events.loads.length = 0;
  h.ref.current?.reload();
  const reloaded = await waitFor(h, () => h.events.loads.includes('load'), 10000);
  r.check('reload after an error loads the page', reloaded && h.state().url === flaky, { loads: h.events.loads, state: h.state() });
  r.check('the reload reports no new error', h.events.errors.length === 1, h.events.errors);
  r.done();
}

/** applicationNameForUserAgent appends to the default UA; userAgent replaces it. Both reach the server. */
async function ua(h: Harness) {
  const r = reporter('ua');
  const read = async () => {
    await openPage(h, `${h.pages}/ua?t=${Date.now()}`);
    return {
      header: (await h.ref.current?.evaluate(`document.getElementById('ua').textContent`)) as string,
      navigator: (await h.ref.current?.evaluate('navigator.userAgent')) as string,
    };
  };
  const suffixed = await read();
  r.check('the app name is appended (header)', suffixed.header.endsWith(' MinimalWebViewExample/1.0'), suffixed);
  r.check('navigator.userAgent matches the header', suffixed.navigator === suffixed.header, suffixed);
  h.setProps({ userAgent: 'CustomAgent/2.0' });
  await sleep(500);
  const custom = await read();
  r.check('userAgent replaces the whole UA', custom.header === 'CustomAgent/2.0' && custom.navigator === 'CustomAgent/2.0', custom);
  h.setProps({});
  await sleep(500);
  const back = await read();
  r.check('removing userAgent restores the default', back.header.endsWith(' MinimalWebViewExample/1.0'), back);
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
    await Promise.race([h.ref.current?.evaluate('1'), sleep(10000)]);
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
    await waitFor(h, (s) => h.events.loads.slice(loadsBefore).includes('end') && s.url === page && idle(s), 15000),
    h.state()
  );
  const recoveredVh = await viewportHeight(h);
  r.check('100vh has a height after recovery', recoveredVh > 0, recoveredVh);
  await sleep(1000);
  r.check('the bridge works after recovery', (await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode)) === 4);

  for (const n of [2, 3]) {
    await kill(n);
  }
  const fourth = await kill(4);
  // Only meaningful when all four crashes fell inside the 60 s window (slow reloads can stretch the test past it).
  const elapsed = Date.now() - firstKillAt;
  if (elapsed < 55000) r.check('a crash loop stops reloading (4th crash in 60 s)', fourth?.recovered === false, fourth);
  else r.info('crash loop check skipped: the 4 crashes took', elapsed);
  r.check('loading a new source works after giving up', await openPage(h, `${h.pages}/?t=${Date.now()}`), h.state());
  r.check('a new source resets the crash-loop guard', (await kill(5))?.recovered === true, h.events.gone.at(-1));
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
  const result = WebView.getAndroidWebViewInfo();
  r.info('getAndroidWebViewInfo', result);
  if (Platform.OS === 'ios') {
    r.check('null on iOS', result === null);
  } else {
    r.check('provider available with a version', result?.available === true && /^\d+\./.test(result.version), result);
    r.check('reports the features in use', Object.keys(result?.features ?? {}).length === 3, result?.features);
  }
  r.done();
}

/**
 * Settings fixed at creation on iOS (applicationNameForUserAgent) recreate the WebView: afterwards the page, the
 * bridge, the extensions and `ask` must all still work. On Android the same change applies in place.
 */
async function recreate(h: Harness) {
  const r = reporter('recreate');
  const page = `${h.pages}/bridge.html?t=${Date.now()}`;
  await openPage(h, page);
  h.setProps({ applicationNameForUserAgent: 'Recreated/9' });
  await sleep(1500);
  await waitFor(h, idle, 10000);
  r.check('the page is shown again', h.state().url === page, h.state());
  const recreatedVh = await viewportHeight(h);
  r.check('100vh has a height after recreation', recreatedVh > 0, recreatedVh);
  await openPage(h, `${h.pages}/ua?t=${Date.now()}`);
  const ua = (await h.ref.current?.evaluate(`document.getElementById('ua').textContent`)) as string;
  r.check('the new app name is in the UA', ua.endsWith(' Recreated/9'), ua);
  await openPage(h, `${h.pages}/bridge.html?t=${Date.now()}`);
  await sleep(500);
  r.check('the bridge works after recreation', (await h.bridge.call('sum', { a: 3, b: 4 }).catch(errorCode)) === 7);
  const asked: string[] = [];
  h.setAsk((request) => {
    asked.push(request.url);
    return 'allow';
  });
  h.setRules([{ path: '/checkout', action: 'ask' }, { scheme: ['http', 'https'], action: 'allow' }]);
  await sleep(300);
  await openPage(h, `${h.pages}/nav.html?t=${Date.now()}`);
  await click(h, 'checkout');
  const reached = await waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 8000);
  r.info('ask after recreation (iOS ask rules arrive in Phase 2)', { reached, asked });
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setProps({});
  await sleep(1500);
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
    { host: 'localhost', path: '/checkout', action: 'ask' },
    { host: 'localhost', newWindow: true, path: '/spa', action: 'allow' },
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
  r.check('onNavigation reports the external decision and rule', lastNavigation()?.action === 'external' && lastNavigation()?.rule === 0, lastNavigation());
  r.check('the page stays', h.state().url === page, h.state());

  await click(h, 'external');
  await waitFor(h, () => external.length > 1, 3000);
  r.check('an outside main-frame link goes external', external[1] === 'https://example.com/', external);

  await click(h, 'open');
  await waitFor(h, () => external.length > 2, 5000);
  r.check('window.open to another site goes external (newWindow)', external[2] === 'https://example.com/popup', external);
  r.check('onNavigation marks it as a new window', lastNavigation()?.newWindow === true, lastNavigation());

  await click(h, 'blank');
  const inPlace = await waitFor(h, (s) => s.url.endsWith('/spa.html') && idle(s), 8000);
  r.check('target=_blank allowed by a newWindow rule loads in place', inPlace, h.state());
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
  else await h.ref.current?.evaluate(`document.getElementById('frame').contentDocument.getElementById('redirect').click()`);
  await sleep(2500);

  const frames = h.events.navigations.filter((n) => !n.mainFrame);
  // Android intercepts only non-http(s) iframe navigations (WebViewClient docs); iOS decides them all.
  if (Platform.OS === 'android') r.info('iframe decisions (http(s) iframes are not intercepted on Android)', frames.length);
  else r.check('iframe navigations are decided as mainFrame false', frames.some((n) => n.action === 'allow'), frames.slice(0, 3));

  asked.length = 0;
  await h.ref.current?.evaluate(`location.href = '/checkout/loopA'`);
  await sleep(5000);
  r.check('an ask redirect loop asks at most once per URL', asked.length >= 1 && asked.length <= 2, asked);
  await openPage(h, `${h.pages}/nav.html?t=${Date.now()}`);

  // Without onOpenExternal native opens externals itself, and reports `block` when nothing can open the URL.
  h.setProps({});
  h.setRules([{ scheme: 'nosuchapp', action: 'external' }]);
  await sleep(500);
  await h.ref.current?.evaluate(`location.href = 'nosuchapp://x'`);
  await waitFor(h, () => lastNavigation()?.url === 'nosuchapp://x', 5000);
  r.check('an external URL nothing opens is reported as block', lastNavigation()?.action === 'block', lastNavigation());

  if (Platform.OS === 'android') {
    // An intent: whose app is not installed falls back to the web.
    h.setProps({});
    h.setRules([{ scheme: 'intent', action: 'external' }, { scheme: ['http', 'https'], action: 'allow' }]);
    await sleep(500);
    const fallback = `${h.pages}/spa.html?from=fallback`;
    await h.ref.current?.evaluate(
      `location.href = 'intent://nothing/#Intent;scheme=nothere;package=com.example.notinstalled;S.browser_fallback_url=${encodeURIComponent(fallback)};end'`
    );
    r.check('intent: without an app loads browser_fallback_url', await waitFor(h, (s) => s.url === fallback && idle(s), 8000), h.state());
  }
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setProps({});
  await sleep(500);
  r.done();
}

/** injectedScripts: start runs before page scripts, end after the DOM, mainFrameOnly skips iframes, changes apply next load. */
async function injection(h: Harness) {
  const r = reporter('injection');
  h.setProps({
    injectedScripts: [
      { code: 'window.__injectedStart = true;', when: 'start' },
      { code: 'window.__injectedEnd = true; window.__marker = "one";', when: 'end', mainFrameOnly: true },
    ],
  });
  await sleep(500);
  await openPage(h, `${h.pages}/injection.html?t=${Date.now()}`);
  await sleep(500);
  const text = async (id: string) =>
    (await h.ref.current?.evaluate(`document.getElementById('${id}').textContent`)) as string;
  r.check('a start script runs before page scripts', (await text('start')) === 'true');
  r.check('an end script runs by load', (await text('end')) === 'true');
  const frame = (await h.ref.current?.evaluate(`(() => {
    const w = document.querySelector('iframe').contentWindow;
    return { start: w.__injectedStart === true, end: w.__injectedEnd === true };
  })()`)) as { start: boolean; end: boolean };
  r.check('a start script without mainFrameOnly runs in iframes', frame.start, frame);
  r.check('a mainFrameOnly script skips iframes', !frame.end, frame);
  h.setProps({ injectedScripts: [{ code: 'window.__marker = "two";', when: 'start' }] });
  await sleep(500);
  r.check('a changed script waits for the next navigation', (await h.ref.current?.evaluate('window.__marker')) === 'one');
  await openPage(h, `${h.pages}/injection.html?t=${Date.now()}`);
  r.check('the changed script applies after navigation', (await h.ref.current?.evaluate('window.__marker')) === 'two');
  r.check('the removed script is gone', (await text('start')) === 'false');
  r.check('the bridge page client still installs', (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'object');
  h.setProps({});
  await sleep(500);
  r.done();
}

/** Downloads: an attachment, a blob: and a data: link all end in onDownload with a sanitised filename. */
async function downloadsSuite(h: Harness) {
  const r = reporter('downloads');
  await openPage(h, `${h.pages}/media.html?t=${Date.now()}`);
  for (const [id, filename] of [
    ['attachment', 'report.txt'],
    ['blob', 'blob.txt'],
    ['data', 'data.txt'],
  ] as const) {
    const before = h.events.downloads.length;
    await click(h, id);
    const done = await waitFor(h, () => h.events.downloads.length > before, 20000);
    const download = h.events.downloads[before];
    // Android's DownloadListener does not pass the link's `download` attribute: data:/blob: names are guessed.
    const nameOk = Platform.OS === 'android' && id !== 'attachment' ? download?.filename.endsWith('.txt') : download?.filename === filename;
    r.check(`${id} download reaches onDownload`, done && nameOk === true, download);
    if (download?.uri.startsWith('file:')) {
      const body = await new File(download.uri).text();
      r.info(`${id} body`, body.slice(0, 40));
    }
  }
  r.done();
}

/** Camera and location reach the page only when the app says yes, the OS allows it and the origin is listed. */
async function permissionsSuite(h: Harness) {
  const r = reporter('permissions');
  const asked: PermissionRequestEvent[] = [];
  let answer = false;
  h.setPermission(async (request) => {
    asked.push(request);
    return answer;
  });
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
    r.check('location granted with app yes + OS permission', /geo ok|geo error [23]/.test(geo), geo);
    answer = false;
    const geoDenied = await press('geo');
    r.check('location denied when the app says no', geoDenied.includes('geo error'), geoDenied);
  }

  const askedBefore = asked.length;
  await openPage(h, `http://127.0.0.1:8090/device.html?t=${Date.now()}`);
  answer = true;
  const other = await press('camera');
  r.check(
    'an origin outside the list is denied without asking',
    other.includes('error') && asked.length === askedBefore,
    { other, asked: asked.length }
  );
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
  const point = (await h.ref.current?.evaluate(`(() => {
    const b = document.getElementById('fullscreen'); b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect(), d = devicePixelRatio;
    return [Math.round((r.left + r.width / 2) * d), Math.round((50 + r.top + r.height / 2) * d)];
  })()`)) as [number, number];
  r.info('TAP', point.join(' '));
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
  r.check('its native side emits through the generic channel', h.events.pageCounts.length > before && event?.url === page, event);
  const inPage = (await h.ref.current?.evaluate('window.__pageCount')) as number;
  r.check('its native side reaches the page', inPage === event?.count, { inPage, event });
  r.done();
}

/** Mount -> first onLoadEnd, minimal-rn-webview vs react-native-webview, alternating runs; medians in ms. */
async function perf(h: Harness) {
  const r = reporter('perf');
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  for (const [label, uri] of [
    ['local page', `${h.pages}/spa.html`],
    ['delfi.ee', 'https://www.delfi.ee/'],
  ] as const) {
    const times: Record<'minimal' | 'rnw', number[]> = { minimal: [], rnw: [] };
    const states: Record<'minimal' | 'rnw', string[]> = { minimal: [], rnw: [] };
    for (let i = 0; i < 5; i++) {
      for (const kind of ['minimal', 'rnw'] as const) {
        const result = await Promise.race([
          h.measureLoad(kind, `${uri}?perf=${Date.now()}`),
          sleep(30000).then(() => null),
        ]);
        if (result) {
          times[kind].push(Math.round(result.ms));
          states[kind].push(result.readyState);
        }
        h.endPerf();
        await sleep(800);
      }
    }
    r.info(`${label} mount->onLoadEnd ms`, {
      minimal: { median: median(times.minimal), runs: times.minimal, readyState: states.minimal },
      rnw: { median: median(times.rnw), runs: times.rnw, readyState: states.rnw },
    });
  }
  r.done();
}

/** Behaviour borrowed from react-native-webview: first-load headers, HTTP auth, shared cookies, download failures, HTTP error pages. */
async function borrowed(h: Harness) {
  const r = reporter('borrowed');
  const text = async (id: string) =>
    (await h.ref.current?.evaluate(`document.getElementById('${id}')?.textContent ?? ''`)) as string;

  const headersPage = `${h.pages}/headers?t=${Date.now()}`;
  h.loadSource({ uri: headersPage, headers: { 'X-Test-Header': 'hello' } });
  await waitFor(h, (s) => s.url === headersPage && idle(s));
  r.check('source.headers reach the first request', (await text('headers')).includes('"x-test-header":"hello"'));

  h.setAuth(() => ({ username: 'u', password: 'p' }));
  await openPage(h, `${h.pages}/auth?t=${Date.now()}`);
  r.check('httpAuth credentials authorize the page', (await text('auth')) === 'authorized', await text('auth'));
  h.setAuth(() => null);
  // Another origin: the WebView caches the credentials it just used for localhost's realm, as browsers do.
  await openPage(h, `http://127.0.0.1:8090/auth?t=${Date.now()}`);
  r.check('httpAuth null cancels (the 401 page shows)', (await text('auth')) === 'unauthorized', await text('auth'));
  let asks = 0;
  h.setAuth(() => {
    asks++;
    return null;
  });
  await openPage(h, `${h.pages}/auth2?t=${Date.now()}`);
  r.check('a decline asks once when the server offers Digest and Basic', asks === 1 && (await text('auth')) === 'unauthorized', asks);
  h.setAuth(undefined);

  clearEvents(h);
  await openPage(h, `${h.pages}/status/404?t=${Date.now()}`);
  await sleep(800);
  r.check('an HTTP 404 still reports onError', h.events.errors.some((e) => e.kind === 'http' && e.code === 404), h.events.errors);
  r.check('an HTTP 404 does not show renderError', !h.events.overlay.error);

  // Native requests (RN fetch) and the WebView share cookies: both directions.
  await fetch(`${h.pages}/setcookie?name=fromNative&value=${Date.now()}`);
  if (Platform.OS === 'ios') {
    // iOS copies them when a WebView is created: force a new one (a creation-time setting).
    h.setProps({ applicationNameForUserAgent: 'Cookies/1' });
    await sleep(1500);
  }
  await openPage(h, `${h.pages}/cookies?t=${Date.now()}`);
  r.check('a cookie set by a native request reaches the page', (await text('cookies')).includes('fromNative='), await text('cookies'));
  await h.ref.current?.evaluate(`document.cookie = 'fromPage=${Date.now()}; path=/'`);
  await sleep(1500);
  const native = await fetch(`${h.pages}/cookies`).then((res) => res.text());
  r.check('a cookie set by the page reaches native requests', native.includes('fromPage='), native.slice(0, 200));
  h.setProps({});
  await sleep(1000);

  if (Platform.OS === 'android') {
    await openPage(h, `${h.pages}/media.html?t=${Date.now()}`);
    const before = h.events.downloadFailures.length;
    await click(h, 'baddata');
    // Chromium may reject a malformed data: URL before the download listener runs; either way the app survives.
    await waitFor(h, () => h.events.downloadFailures.length > before, 5000);
    r.info('invalid data: download failures reported', h.events.downloadFailures.slice(before));
    r.check('the app survives an invalid data: download', (await h.ref.current?.evaluate('1 + 1')) === 2);
  }
  r.done();
}

/**
 * Parity with react-native-webview: the same scenarios against both libraries, reported side by side as
 * `INFO parity: <scenario> {"minimal": …, "rnw": …}`. These are observations, not pass/fail: docs/PARITY.md reads them.
 */
async function parity(h: Harness) {
  const r = reporter('parity');
  const rnw = h.rnw();
  const open = async (uri: string) => {
    rnw.events.length = 0;
    h.showRnw({ uri });
    const end = Date.now() + 15000;
    while (Date.now() < end && !rnw.events.some((e) => e.name === 'loadEnd')) await sleep(100);
    await sleep(600);
  };
  const names = () => rnw.events.map((e) => e.name);
  const lastUrl = () =>
    rnw.events
      .filter((e) => e.name === 'navigationState')
      .map((e) => e.data['url'])
      .at(-1);
  const report = (scenario: string, minimal: unknown, other: unknown) => r.info(scenario, { minimal, rnw: other });

  // 1. SPA URL tracking: pushState, replaceState and hash.
  const spa = `${h.pages}/spa.html?t=${Date.now()}`;
  await openPage(h, spa);
  await open(spa);
  for (const id of ['push', 'replace', 'hash']) {
    await click(h, id);
    await rnw.evaluate(`document.getElementById('${id}').click()`);
    await sleep(1200);
    const page = (await rnw.evaluate('location.href')) as string;
    report(`SPA ${id}: reported url matches location.href`, h.state().url === (await h.ref.current?.evaluate('location.href')), lastUrl() === page);
  }

  // 2. Server redirect: the final URL is reported.
  await openPage(h, `${h.pages}/spa.html?t=${Date.now()}`);
  await click(h, 'redirect');
  await waitFor(h, (s) => s.url.includes('from=redirect') && idle(s));
  await rnw.evaluate(`document.getElementById('redirect').click()`);
  await sleep(2000);
  report('redirect: final url reported', h.state().url.includes('from=redirect'), String(lastUrl()).includes('from=redirect'));

  // 3. A network failure: events fired.
  clearEvents(h);
  h.load('http://localhost:8099/nothing');
  await waitFor(h, () => h.events.errors.length > 0, 10000);
  await sleep(800);
  rnw.events.length = 0;
  h.showRnw({ uri: 'http://localhost:8099/nothing' });
  await sleep(5000);
  report('network failure: callbacks', { errors: h.events.errors.map((e) => e.kind), loads: h.events.loads }, names());

  // 4. An HTTP 404: events fired.
  clearEvents(h);
  await openPage(h, `${h.pages}/status/404?t=${Date.now()}`);
  await sleep(800);
  await open(`${h.pages}/status/404?t=${Date.now()}`);
  report('HTTP 404: callbacks', { errors: h.events.errors.map((e) => `${e.kind} ${e.code}`), loads: h.events.loads }, names());

  // 5. window.open and target=_blank with no rules / defaults.
  const nav = `${h.pages}/nav.html?t=${Date.now()}`;
  await openPage(h, nav);
  await open(nav);
  clearEvents(h);
  await click(h, 'blank');
  await sleep(2500);
  rnw.events.length = 0;
  await rnw.evaluate(`document.getElementById('blank').click()`);
  await sleep(2500);
  report('target=_blank (defaults)', { url: h.state().url, decisions: h.events.navigations.map((n) => `${n.action}${n.newWindow ? ' new' : ''}`) }, { names: names(), url: lastUrl() });

  // 6. Back after pushState: canGoBack and the URL after goBack.
  await openPage(h, `${h.pages}/spa.html?t=${Date.now()}`);
  await click(h, 'push');
  await sleep(800);
  const minimalCanGoBack = h.state().canGoBack;
  h.ref.current?.goBack();
  await sleep(1200);
  await open(`${h.pages}/spa.html?t=${Date.now()}`);
  await rnw.evaluate(`document.getElementById('push').click()`);
  await sleep(1200);
  const rnwCanGoBack = rnw.events
    .filter((e) => e.name === 'navigationState')
    .map((e) => e.data['canGoBack'])
    .at(-1);
  rnw.goBack();
  await sleep(1500);
  report('pushState then back: canGoBack, url after back', { canGoBack: minimalCanGoBack, url: h.state().url }, { canGoBack: rnwCanGoBack, url: lastUrl() });

  // 7. evaluate/inject a value back: RNW needs postMessage; round-trip time of a page -> RN message.
  const t0 = Date.now();
  await h.ref.current?.evaluate('1 + 1');
  const minimalEval = Date.now() - t0;
  const t1 = Date.now();
  await rnw.evaluate('1 + 1');
  report('evaluate round trip (ms)', minimalEval, Date.now() - t1);

  // 8. A cookie set by a native request: visible to the page without any option.
  await fetch(`${h.pages}/setcookie?name=parity&value=${Date.now()}`);
  await openPage(h, `${h.pages}/cookies?t=${Date.now()}`);
  const minimalCookies = (await h.ref.current?.evaluate(`document.getElementById('cookies').textContent`)) as string;
  await open(`${h.pages}/cookies?t=${Date.now()}`);
  const rnwCookies = (await rnw.evaluate(`document.getElementById('cookies').textContent`)) as string;
  report('native cookie visible to the page (minimal sharedCookies(), RNW sharedCookiesEnabled)', minimalCookies.includes('parity='), String(rnwCookies).includes('parity='));

  // 9. The user agent.
  await openPage(h, `${h.pages}/ua?t=${Date.now()}`);
  const minimalUa = await h.ref.current?.evaluate('navigator.userAgent');
  await open(`${h.pages}/ua?t=${Date.now()}`);
  report('default user agent (minimal has applicationNameForUserAgent set)', minimalUa, await rnw.evaluate('navigator.userAgent'));

  // 10. onLoad for a page whose load event is late (readyState when each library's onLoadEnd fires).
  h.hideRnw();
  r.done();
}

export const SUITES: Record<string, (h: Harness) => Promise<void>> = {
  urlTracking,
  realSite,
  reissue,
  bridge,
  ptr,
  upload,
  errors,
  ua,
  crash,
  dialogs,
  info,
  recreate,
  overlays,
  navigation,
  injection,
  downloads: downloadsSuite,
  permissions: permissionsSuite,
  fullscreen,
  sampleExtension,
  perf,
  borrowed,
  parity,
};
