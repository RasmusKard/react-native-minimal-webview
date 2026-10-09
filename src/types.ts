import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

/** `headers` go on the first request only, not on later navigations. */
export type WebViewSource = { uri: string; headers?: Record<string, string> } | { html: string; baseUrl?: string };

export type NavigationAction = 'allow' | 'block' | 'external';

/**
 * One navigation rule. Every field that is set must match; the first matching rule wins.
 * With no rules, http(s) loads in place and other schemes open externally. With rules and no match, the result is `block`.
 */
export type NavigationRule = {
  /** Exact, case-insensitive: `['tel', 'mailto']`. */
  scheme?: string | string[];
  /** Exact, or a `*.` suffix wildcard that matches subdomains only: `'*.example.com'` does not match `example.com`. */
  host?: string | string[];
  /** Plain prefix of the URL path: `'/checkout'` also matches `/checkouts`. */
  path?: string | string[];
  mainFrame?: boolean;
  newWindow?: boolean;
  /** A user gesture started it (Android `hasGesture()`, iOS `.linkActivated`). */
  userInitiated?: boolean;
  /** `ask` calls `onNavigationRequest`. On Android it only works for the main frame; elsewhere it falls back to `block`. */
  action: NavigationAction | 'ask';
};

export type NavigationRequest = {
  url: string;
  mainFrame: boolean;
  newWindow: boolean;
  userInitiated: boolean;
};

export type NavigationEvent = NavigationRequest & {
  action: NavigationAction;
  /** Index of the matching rule in `navigationRules`, or null when the default or an extension decided. */
  rule: number | null;
};

export type NavigationState = {
  /** The committed URL. Changes on commit and same-document navigation (pushState, hash); iframes never change it. */
  url: string;
  /** A main-frame navigation that has started but not committed. */
  pendingUrl: string | null;
  title: string;
  loading: boolean;
  /** 0..1 */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type WebViewErrorEvent = {
  kind: 'network' | 'http' | 'ssl';
  url: string;
  /** Platform error code, or the HTTP status for `http`. */
  code: number;
  description: string;
};

export type ProcessGoneEvent = {
  didCrash: boolean;
  /** The core reloaded the page in a new process. */
  recovered: boolean;
};

export type InjectedScript = {
  code: string;
  /** Document start runs before any page script; end runs after the DOM is parsed. */
  when: 'start' | 'end';
  mainFrameOnly?: boolean;
};

export type BridgeHandler = (params: unknown) => unknown;

/** A promise-based RPC channel to `window.nativeBridge` in the page. Attach it with the `bridge` prop. */
export type Bridge = {
  /** Answers `nativeBridge.call(method, params)` from the page. Returns an unsubscribe function. */
  handle(method: string, handler: BridgeHandler): () => void;
  /** Calls a method the page registered with `nativeBridge.handle`. Rejects on timeout, navigation or teardown. */
  call(method: string, params?: unknown): Promise<unknown>;
  /** Fires an event the page listens to with `nativeBridge.on`. */
  emit(event: string, payload?: unknown): void;
  /** Listens to `nativeBridge.emit(event, payload)` from the page. Returns an unsubscribe function. */
  on(event: string, listener: (payload: unknown) => void): () => void;
};

export type BridgeOptions = {
  /** Origin rules the page must match (Android origin-rule format): `['https://example.com', 'https://*.example.com']`. */
  allowedOrigins: string[];
  /** Per-call timeout. Default 10 000 ms. */
  timeoutMs?: number;
};

/** What an extension helper such as `pullToRefresh()` returns. */
export type WebViewExtension = {
  /** The native extension to enable for this instance, by its registered name. */
  native: { name: string; config?: Record<string, unknown> };
  /** Events the native side emits on the generic extension channel. */
  onEvent?: (event: string, payload: Record<string, unknown>) => unknown;
};

/** The WebView's own props. The rest of `WebViewProps` is React Native's `ViewProps`. */
type OwnProps = {
  source: WebViewSource;
  /** Replaces the whole user agent. */
  userAgent?: string;
  /** Appended to the default user agent. On iOS it is fixed at creation: changing it recreates the WebView. */
  applicationNameForUserAgent?: string;
  injectedScripts?: InjectedScript[];
  navigationRules?: NavigationRule[];
  /** Called only for `ask` rules. Times out after 1 s, then `block`. */
  onNavigationRequest?: (
    request: NavigationRequest
  ) => NavigationAction | Promise<NavigationAction>;
  /** Opens `external` navigations. Default: the system browser or app for the URL. */
  onOpenExternal?: (url: string) => void;
  /** Fixed at mount, like `extensions`: remount with a new `key` to change it. */
  bridge?: Bridge;
  /** Android only; WebKit blocks third-party cookies on iOS. */
  thirdPartyCookies?: boolean;
  /** Default true. On iOS it is fixed at creation: changing it recreates the WebView. */
  mediaPlaybackRequiresUserAction?: boolean;
  /** iOS only (Android always plays inline). Default false. Fixed at creation. */
  allowsInlineMediaPlayback?: boolean;
  /** iOS only. Default true. */
  scrollEnabled?: boolean;
  /** iOS only. Default true. */
  bounces?: boolean;
  showsScrollIndicators?: boolean;
  /**
   * Lets a script open a window (`window.open`) without a user gesture. Default false: only a tap opens one. The
   * navigation rules still decide it (`newWindow: true`). Some flows need it, like an OAuth popup opened after an
   * `await`.
   */
  javaScriptCanOpenWindowsAutomatically?: boolean;
  /** Default `__DEV__`. Process-wide on Android: the last WebView to set it wins. */
  webviewDebuggingEnabled?: boolean;
  /** Fixed at mount: a change is ignored with a warning; remount with a new `key` to apply it. Handlers stay live. */
  extensions?: WebViewExtension[];
  renderLoading?: () => ReactNode;
  /** Shown for network and SSL failures. An HTTP error status keeps the site's own error page (onError still fires). */
  renderError?: (error: WebViewErrorEvent) => ReactNode;

  onNavigation?: (event: NavigationEvent) => void;
  /** Changes within one frame are combined into one call. */
  onNavigationStateChange?: (state: NavigationState) => void;
  onError?: (event: WebViewErrorEvent) => void;
  onProcessGone?: (event: ProcessGoneEvent) => void;
  /** JS-only aliases derived from `loading`. */
  onLoadStart?: (state: NavigationState) => void;
  onLoad?: (state: NavigationState) => void;
  onLoadEnd?: (state: NavigationState) => void;
};

/**
 * Plus React Native's `ViewProps` (`style`, `testID`, `nativeID`, the accessibility props, layout and touch events).
 * They go to the outermost view: the native view, or the container when `renderLoading` or `renderError` is set.
 */
export type WebViewProps = OwnProps & Omit<ViewProps, keyof OwnProps | 'children'>;

export type WebViewRef = {
  goBack(): void;
  goForward(): void;
  reload(): void;
  stopLoading(): void;
  /**
   * Runs an expression in the page's main frame and awaits it. Resolves with its value through JSON (`null` for what
   * JSON can't encode); rejects with `ERR_EVALUATE` when it throws or rejects, or `navigated` (Android) on a new page.
   */
  evaluate(script: string): Promise<unknown>;
  /** Reads the native URL property directly. */
  getUrl(): Promise<string>;
};

export type AndroidWebViewInfo = {
  version: string;
  provider: string;
  /** False when the WebView provider is missing or disabled. */
  available: boolean;
  /** `WebViewFeature` name to support, for the features this package uses. */
  features: Record<string, boolean>;
};
