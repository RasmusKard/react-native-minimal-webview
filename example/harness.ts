// Scripted spike checks. Results go to the JS console as `[harness] PASS|FAIL|INFO ...` lines, readable from
// logcat (ReactNativeJS) or the Metro log, so no screenshots are needed.
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import type {
  Bridge,
  FileRequest,
  NavigationRule,
  NavigationState,
  WebViewProps,
  WebViewRef,
} from 'minimal-rn-webview';
import type { RefObject } from 'react';
import { Platform } from 'react-native';

export type Harness = {
  pages: string;
  platform: string;
  ref: RefObject<WebViewRef | null>;
  state: () => NavigationState;
  load: (uri: string) => void;
  setRules: (rules: NavigationRule[] | undefined) => void;
  setAsk: (ask: WebViewProps['onNavigationRequest']) => void;
  bridge: Bridge;
  /** Payloads of `pageEvent` events the page emitted. */
  pageEvents: unknown[];
  setFileRequest: (handler: ((request: FileRequest) => Promise<string[] | null>) | undefined) => void;
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
  r.check(
    'iframe navigations into an ask rule are blocked without asking',
    asked.length === beforeFrame,
    asked
  );

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
  r.info('pull inside a scrolled inner scroller reloads (known Android limitation)', await pull('inner'));
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

export const SUITES: Record<string, (h: Harness) => Promise<void>> = {
  urlTracking,
  realSite,
  reissue,
  bridge,
  ptr,
  upload,
};
