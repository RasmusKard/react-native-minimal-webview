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
import { AndroidWebView } from 'react-native-minimal-webview';

import { PAGES } from '../pages';
import { clearEvents, idle, waitForLoad } from './helpers';

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

function emit(line: string) {
  const text = `[harness ${Platform.OS} ${Platform.Version}] ${line}`;
  console.log(text);
  // A failed post surfaces as an unhandled rejection; the console line above still has the result.
  void fetch(`${PAGES}/harness/log?platform=${Platform.OS}`, {
    method: 'POST',
    body: text,
  });
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
  message: DriverAction | { action: 'done'; pass: number; fail: number },
  suite: string
) {
  const text = JSON.stringify({ suite, ...message });
  showRequest(text);
  // As in emit: a failed post surfaces as an unhandled rejection, and the driver's wait for it times out.
  void fetch(`${PAGES}/harness/request?platform=${Platform.OS}`, {
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
export const androidWebView = () =>
  (webViewMajor ??= Number(/Chrome\/(\d+)/.exec(AndroidWebView.defaultUserAgent ?? '')?.[1] ?? 0));

/** What a suite reports through. */
export type Reporter = {
  check(name: string, ok: boolean, detail?: unknown): void;
  /**
   * A check, or on an Android System WebView older than `version` (a `WEBVIEW` value) the INFO line
   * `known limit (WebView <version>): <name>`: that WebView lacks what the check needs.
   */
  since(version: number, name: string, ok: boolean, detail?: unknown): void;
  info(name: string, detail: unknown): void;
  /** Asks the driver for `action`; `why` is for the log. The suite then waits for what the action causes. */
  drive(action: DriverAction, why?: unknown): void;
};
/**
 * A suite: it reports `skipped` on a platform it doesn't apply to, leaves nothing behind that `reset()` doesn't undo,
 * and needs no site but the test pages server. The runner gives it its reporter and sends its verdict.
 */
export type Suite = (h: Harness, r: Reporter) => Promise<void>;

/** `r` with each `check` as a `since(floor, …)`, for a suite that needs that WebView throughout. */
export const withFloor = (r: Reporter, floor: number): Reporter => ({
  ...r,
  check: (name, ok, detail) => r.since(floor, name, ok, detail),
});

/** A suite's reporter, and what the runner ends it with: a failure of the run itself, and the verdict. */
function reporter(suite: string) {
  let pass = 0;
  let fail = 0;
  const info = (name: string, detail: unknown) =>
    emit(`INFO ${suite}: ${name} ${JSON.stringify(detail)}`);
  const check = (name: string, ok: boolean, detail: unknown = '') => {
    if (ok) pass++;
    else fail++;
    emit(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
  };
  const r: Reporter = {
    check,
    info,
    since(version, name, ok, detail = '') {
      const major = androidWebView();
      if (major > 0 && major < version)
        info(`known limit (WebView <${version}): ${name}`, { major, ok, detail });
      else check(name, ok, detail);
    },
    drive(action, why = '') {
      request(action, suite);
      info('drive', [action, why]);
    },
  };
  return {
    r,
    failed: (what: string, error: unknown) => check(what, false, String(error)),
    done() {
      request({ action: 'done', pass, fail }, suite);
      emit(`DONE ${suite} pass=${pass} fail=${fail}`);
    },
  };
}

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
    const { r, failed, done } = reporter(name);
    // Whatever happens the suite gets one verdict, so the driver doesn't wait for one until it times out.
    try {
      const suite = suites[name];
      if (!suite) throw new Error('unknown suite');
      await suite(h, r);
    } catch (error) {
      failed('the suite threw', error);
    }
    // Before the verdict: what a suite leaves behind fails it, and makes the driver launch the app fresh.
    await reset(h).catch((error: unknown) => failed('the reset after it threw', error));
    done();
    busy = false;
  }, 50);
  return () => clearInterval(timer);
}

/**
 * Puts back what suites change, so the next suite starts clean even after one threw: the handlers, rules and extra
 * props, the event logs, and a new WebView on the home page (an Android settings key with no getter is not reset by its
 * absence). Throws when that page doesn't load.
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
  clearEvents(h);
}
