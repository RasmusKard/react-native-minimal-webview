// Runs the on-device suites (suites/index.ts) inside the example app. Each result is logged as
// `[harness <platform>] PASS|FAIL|SKIP|INFO ...` to the JS console and to the test pages server, which prints it.
import { Platform } from 'react-native';
import type {
  Bridge,
  Download,
  DownloadFailure,
  NavigationEvent,
  NavigationRule,
  ProcessGoneEvent,
  LoadErrorEvent,
  NavigationState,
  WebViewProps,
  WebViewRefObject,
  WebViewSource,
} from 'react-native-minimal-webview';
import { AndroidWebView, IOSConstants } from 'react-native-minimal-webview';

import { PAGES } from '../pages';
import { clearEvents, idle, poll, sleep, waitForLoad } from './helpers';

type Kind = 'PASS' | 'FAIL' | 'SKIP' | 'INFO' | 'DONE';

/**
 * Extra WebView props for a suite. Its `extensions` come after App's own, the page counter, which `withoutPageCounter`
 * leaves out.
 */
export type HarnessProps = Partial<WebViewProps> & { withoutPageCounter?: boolean };

export type Harness = {
  pages: string;
  platform: string;
  ref: WebViewRefObject;
  /** Where the WebView sits in the window and its height, in dp, for a driver's tap; kept current by App's onLayout. */
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

/** `performance.now()` at App's first render and at its first onLoadEnd: the perfCold suite's cold mount. */
export const launchMarks: { render?: number; loadEnd?: number } = {};

let posted: Promise<unknown> = Promise.resolve();
/**
 * Posts `body` to the test pages server after the posts before it, so log lines and driver requests arrive in the
 * order the suite made them. A failed post surfaces as an unhandled rejection, later posts still go out, and the
 * driver's wait for a lost request times out.
 */
function post(path: string, body: string) {
  posted = posted.finally(() =>
    fetch(`${PAGES}/harness/${path}?platform=${Platform.OS}`, { method: 'POST', body })
  );
}

/** A line of the log, and for the server's report what it is about: the suite, its block ('' outside one) and the name. */
function emit(kind: Kind, suite: string, block: string, name: string, detail: string) {
  const where = block ? `${suite} > ${block}` : suite;
  const text = `[harness ${Platform.OS} ${Platform.Version}] ${kind} ${where}${kind === 'DONE' ? '' : ':'} ${name} ${detail}`;
  console.log(text);
  post('log', JSON.stringify({ text, kind, suite, block, name, detail }));
}

let showRequest: (text: string) => void = () => {};
/** Shows each driver request and verdict on screen (testID `harness-request`), as the JSON the driver gets. */
export const onDriverRequest = (listener: (text: string) => void) => (showRequest = listener);

/**
 * What a suite asks the outside driver (maestro/suite.yaml) to do on the device. A `point` is Maestro's: `x, y` in
 * screen pixels (points on iOS), or in percent of the screen (`50%, 49%`).
 */
export type DriverAction =
  | { action: 'tap'; point: string }
  /** A tap that opens something over the app (the system file chooser), then back once it covers the app. */
  | { action: 'tapThenBack'; point: string }
  | { action: 'longPress'; point: string }
  /** A native button by its text (a dialog's, a menu item's), once it shows. */
  | { action: 'press'; text: string }
  | { action: 'back' }
  /** A pull down the page: from its top (`full`), a little (`short`), or from the top of an inner scroller. */
  | { action: 'swipe'; kind: 'full' | 'short' | 'inner' }
  /** Kills the page's renderer process. */
  | { action: 'kill' }
  /** The same with the app in the background: home, the kill, and the app again 5 s later. */
  | { action: 'killInBackground' }
  /** Gives the device a location fix. */
  | { action: 'location' };

/**
 * A driver request, or a suite's verdict (`action: 'done'`): on screen, and posted to the test server, where the driver
 * waits for it.
 */
function request(
  message: DriverAction | { action: 'done'; pass: number; fail: number; skip: number },
  suite: string
) {
  const text = JSON.stringify({ suite, ...message });
  showRequest(text);
  post('request', text);
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
export const androidWebView = () =>
  (webViewMajor ??= Number(/Chrome\/(\d+)/.exec(AndroidWebView.defaultUserAgent ?? '')?.[1] ?? 0));

/** What a suite reports through. */
export type Reporter = {
  check(name: string, ok: boolean, detail?: unknown): void;
  /**
   * A check, or a skip on an Android System WebView older than `version` (a `WEBVIEW` value): that WebView lacks what
   * the check needs.
   */
  since(version: number, name: string, ok: boolean, detail?: unknown): void;
  /** A check, a block or the suite that doesn't apply here (the platform, the device), and `why`: a SKIP line. */
  skip(name: string, why: unknown): void;
  info(name: string, detail: unknown): void;
  /** Runs a named part of the suite: its lines carry `name`, a throw in it too. */
  block(name: string, run: () => Promise<void>): Promise<void>;
  /** Runs `undo` when the suite ends, also after it threw, last added first. A throw from it fails the suite. */
  cleanup(undo: () => unknown): void;
  /** Asks the driver for `action`; `why` is for the log. The suite then waits for what the action causes. */
  drive(action: DriverAction, why?: unknown): void;
};
/**
 * A suite: it reports a `skip` on a platform it doesn't apply to, leaves nothing behind that `reset()` or its own
 * `cleanup`s don't undo, and needs no site but the test pages server. The runner gives it its reporter and sends its verdict.
 */
export type Suite = (h: Harness, r: Reporter) => Promise<void>;

/** `r` with each `check` as a `since(floor, …)`, for a suite that needs that WebView throughout. */
export const withFloor = (r: Reporter, floor: number): Reporter => ({
  ...r,
  check: (name, ok, detail) => r.since(floor, name, ok, detail),
});

/**
 * A suite's reporter, and what the runner ends it with: a failure of the run itself, the suite's cleanups, and the
 * verdict.
 */
function reporter(suite: string) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  const cleanups: (() => unknown)[] = [];
  let block = '';
  let last = 'its start';
  const line = (kind: 'PASS' | 'FAIL' | 'SKIP' | 'INFO', name: string, detail: unknown) => {
    if (kind !== 'INFO') counts[kind]++;
    last = name;
    emit(kind, suite, block, name, kind === 'PASS' ? '' : JSON.stringify(detail));
  };
  const check = (name: string, ok: boolean, detail: unknown = '') =>
    line(ok ? 'PASS' : 'FAIL', name, detail);
  // A throw has no line of its own to point at: `last` says how far the suite got.
  const failed = (what: string, error: unknown) => {
    line('FAIL', what, `${String(error)} (after: ${last})`);
  };
  const r: Reporter = {
    check,
    info: (name, detail) => line('INFO', name, detail),
    skip: (name, why) => line('SKIP', name, why),
    since(version, name, ok, detail = '') {
      const major = androidWebView();
      if (major > 0 && major < version)
        line('SKIP', name, { needs: `WebView ${version}`, major, ok, detail });
      else check(name, ok, detail);
    },
    drive(action, why = '') {
      request(action, suite);
      line('INFO', 'drive', [action, why]);
    },
    async block(name, run) {
      block = name;
      await run();
      block = '';
    },
    cleanup: (undo) => void cleanups.push(undo),
  };
  return {
    r,
    failed,
    async cleanUp() {
      for (const undo of cleanups.reverse())
        await Promise.resolve()
          .then(undo)
          .catch((error: unknown) => failed('a cleanup threw', error));
    },
    done() {
      const [pass, fail, skip] = [counts.PASS, counts.FAIL, counts.SKIP];
      request({ action: 'done', pass, fail, skip }, suite);
      emit('DONE', suite, '', `pass=${pass} fail=${fail} skip=${skip}`, '');
    },
  };
}

/** A suite's time. The driver waits 280 s for a suite's next request or verdict (maestro/scripts/next.js). */
const SUITE_MS = 270_000;
/** Rejects once a suite has run for `SUITE_MS`, so a wait that never ends still gets it a verdict. */
const overtime = () =>
  sleep(SUITE_MS).then(() => {
    throw new Error(`still running after ${SUITE_MS / 1000} s`);
  });

/** Runs the `suites` queued by name with `/harness/run?platform=ios&suite=<name>` on the test pages server. */
export function pollForSuites(get: () => Harness, suites: Record<string, Suite>) {
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
    const h = get();
    const { r, failed, cleanUp, done } = reporter(name);
    // Whatever happens the suite gets one verdict, so the driver doesn't wait for one until it times out.
    try {
      const suite = suites[name];
      if (!suite) throw new Error('unknown suite');
      await Promise.race([suite(h, r), overtime()]);
    } catch (error) {
      failed('the suite threw', error);
    }
    // Before the verdict: what a suite leaves behind fails it, and makes the driver launch the app fresh.
    await cleanUp();
    await reset(h).catch((error: unknown) => failed('the reset after it threw', error));
    done();
    busy = false;
  }, 50);
  return () => clearInterval(timer);
}

/**
 * Puts back what suites change, so the next suite starts clean even after one threw: the handlers, rules and extra
 * props, the event logs, a new WebView on the home page (an Android settings key with no getter is not reset by its
 * absence), and every site's cookies and storage (the HTTP cache stays). Throws when that page doesn't load, and on
 * Android when another window is still over the app.
 */
async function reset(h: Harness) {
  h.setProps({});
  h.setExtraWebViews(0);
  h.setCovered(false);
  h.setRules(undefined);
  h.setAsk(undefined);
  h.setPermission(undefined);
  h.setFileRequest(undefined);
  const home = `${PAGES}/`;
  await waitForLoad(
    h,
    () => {
      h.loadSource({ uri: home });
      h.remount();
    },
    (s) => s.url === home && idle(s),
    10000
  );
  const { cookies, sessionStorage, localStorage, indexedDBDatabases } =
    IOSConstants.WebsiteDataType;
  await (Platform.OS === 'ios'
    ? h.ref.current?.call('websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:', [
        { set: [cookies, sessionStorage, localStorage, indexedDBDatabases] },
        { date: 0 },
      ])
    : Promise.all([
        h.ref.current?.call('cookieManager.removeAllCookies'),
        h.ref.current?.call('webStorage.deleteAllData'),
      ]));
  clearEvents(h);
  // A dialog a suite left up has the window focus, and would take the next suite's touches.
  if (
    Platform.OS === 'android' &&
    !(await poll(() => h.ref.current?.call('webView.hasWindowFocus'), 3000))
  )
    throw new Error('a window is left over the app');
}
