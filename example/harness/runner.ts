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

import { clearEvents, idle, waitForLoad } from './helpers';
import { ON_DEMAND, SUITES } from '../suites/index';

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
export const androidWebView = () =>
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

/** Runs suites queued with `/harness/run?platform=ios&suite=<name>` on the test pages server. */
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
