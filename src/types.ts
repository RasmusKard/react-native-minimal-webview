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
  /**
   * The page on screen: changes on commit and same-document navigation (pushState, replaceState, hash), and stays the
   * old page while a load is in progress. After a failed load, the failed URL. Iframes never change it.
   */
  url: string;
  /** A main-frame load in progress, which may still fail or be blocked. */
  pendingUrl: string | null;
  title: string;
  loading: boolean;
  /** 0..1 */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
};

/** A main-frame load that failed: no page arrived. */
export type WebViewErrorEvent = {
  kind: 'network' | 'ssl';
  url: string;
  /** Platform error code. */
  code: number;
  description: string;
};

/** A main-frame response with an HTTP error status (400+). The site's own error page still shows. */
export type WebViewHttpErrorEvent = {
  url: string;
  statusCode: number;
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

/** `<input type="file">` (Android). `capture` is the input's `capture` attribute: the page wants the camera. */
export type FileRequest = { accept: string[]; multiple: boolean; capture: boolean };

export type PermissionResource = 'camera' | 'microphone' | 'geolocation';
/** `origin` is the requesting page's, as `location.origin` writes it. Only the main frame asks. */
export type PermissionRequestEvent = { origin: string; resources: PermissionResource[] };

/**
 * A finished download: `uri` is a `file://` in the app's cache (iOS: the temporary directory). `url` is the server URL
 * the file came from; `null` when the page generated it (`data:` or `blob:` URL).
 */
export type Download = { uri: string; filename: string; mimeType: string; url: string | null };

/**
 * A download that could not be saved (a bad data: or blob: URL, a network or HTTP error). `url` as in {@link Download}.
 * `'uri' in result` tells it from a {@link Download}.
 */
export type DownloadFailure = { filename: string; url: string | null; reason: string };

export type AuthRequest = { host: string; realm: string };

/** What an extension helper such as `pullToRefresh()` returns. */
export type WebViewExtension = {
  /** The native extension to enable for this instance, by its registered name. */
  native: { name: string; config?: Record<string, unknown> };
  /**
   * Handlers for the events the native extension emits, by event name. A handler's return value answers a native
   * `ask`. Native can check which events have a handler (`host.handles`), to fall back to a default without one.
   */
  on?: Record<string, ExtensionHandler | undefined>;
};

/** Takes the event's payload; `never` lets each handler declare the payload type its native side sends. */
export type ExtensionHandler = (payload: never) => unknown;

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
  thirdPartyCookiesEnabled?: boolean;
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
  /**
   * Add-ons such as `pullToRefresh()`. Fixed at mount: a change is ignored with a warning; remount with a new `key` to
   * apply it. Handlers stay live.
   */
  extensions?: WebViewExtension[];

  // Page requests: each works without its prop, as described. Passing one takes the request over. They can be added or
  // removed at any time. An extension that handles the same platform callback comes first.
  /**
   * `<input type="file">` on Android: return `file://` or `content://` URIs, or null to cancel. Without it, the system
   * file chooser opens (it ignores `capture`). iOS always shows WebKit's picker.
   */
  onFileRequest?: (request: FileRequest) => string[] | null | Promise<string[] | null>;
  /**
   * Android: the page entered or left fullscreen. Fullscreen works without it: the page's view covers the window, the
   * system bars hide and back exits. iOS: WebKit's own fullscreen, not reported.
   */
  onFullscreenChange?: (active: boolean) => void;
  /**
   * Camera, microphone and (Android) location for the main frame. Answer true to grant: ask the OS first (expo-camera,
   * expo-location), or the page's request fails anyway. Without it: Android denies; iOS shows WebKit's own prompt, and
   * location always does.
   */
  onPermissionRequest?: (request: PermissionRequestEvent) => boolean | Promise<boolean>;
  /**
   * A download finished ({@link Download}, a file in the app's cache) or failed ({@link DownloadFailure}). Without it,
   * an http(s) download opens externally (`onOpenExternal` or the system browser, without the page's session), and a
   * `data:` or `blob:` one is dropped.
   */
  onDownload?: (result: Download | DownloadFailure) => void;
  /** HTTP basic or digest auth: return credentials, or null to cancel. Without it, cancelled: the site's 401 page shows. */
  onHttpAuthRequest?: (
    request: AuthRequest
  ) =>
    | { username: string; password: string }
    | null
    | Promise<{ username: string; password: string } | null>;
  renderLoading?: () => ReactNode;
  /** Shown for network and SSL failures. An HTTP error status keeps the site's own error page (onHttpError fires). */
  renderError?: (error: WebViewErrorEvent) => ReactNode;

  onNavigation?: (event: NavigationEvent) => void;
  /** Changes within one frame are combined into one call. */
  onNavigationStateChange?: (state: NavigationState) => void;
  onError?: (event: WebViewErrorEvent) => void;
  onHttpError?: (event: WebViewHttpErrorEvent) => void;
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
  /** The committed `url`, as in the navigation state, read from native now. */
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
