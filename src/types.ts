import type { ViewProps } from 'react-native';

import type { BridgeErrorCode } from './bridge/protocol';
import type {
  AndroidSettingKeys,
  CGPoint,
  CGRect,
  CGSize,
  IOSSettingKeys,
  UIEdgeInsets,
} from './platform.generated';

/**
 * `headers` go on the first request only, not on later navigations. `body` makes the request a POST with that
 * form-urlencoded body (`a=1&b=2`): iOS sends `headers` with it and sets `Content-Type` when they don't; Android's
 * `postUrl` sends neither. `reload()` and crash recovery send the POST again. A `file://` uri loads with read access
 * to its directory on iOS; Android needs `android.settings.allowFileAccess`.
 */
export type WebViewSource =
  | { uri: string; headers?: Record<string, string>; body?: string }
  | { html: string; baseUrl?: string };

export type NavigationAction = 'allow' | 'block' | 'external';

/**
 * One navigation rule. Every field that is set must match; the first matching rule wins.
 * With no rules, http(s) loads in place and other schemes open externally from the main frame (a subframe is blocked). With rules and no match, the result is `block`.
 */
export type NavigationRule = {
  /** Exact, case-insensitive: `['tel', 'mailto']`. */
  scheme?: string[];
  /** Exact, or a `*.` suffix wildcard that matches subdomains only: `['*.example.com']` does not match `example.com`. */
  host?: string[];
  /** Plain prefixes of the URL path: `['/checkout']` also matches `/checkouts`. */
  path?: string[];
  /**
   * Query parameters, percent-encoded as in the URL and case-sensitive: `gad_source` matches a parameter with that
   * name, whatever its value; `utm_term=google` matches only that exact value.
   */
  query?: string[];
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
  /** Index of the matching rule in `navigationRules`, or null when the default or a native hook decided. */
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

/**
 * Runs at document start, before any page script. Code for when the DOM is parsed goes in
 * `addEventListener('DOMContentLoaded', …)`.
 */
export type InjectedScript = {
  code: string;
  mainFrameOnly?: boolean;
};

export type BridgeHandler = (params: unknown) => unknown;

/** A promise-based RPC channel to `window.nativeBridge` in the page. Attach it with the `bridge` prop. */
export type Bridge = {
  /** Answers `nativeBridge.call(method, params)` from the page. Returns an unsubscribe function. */
  handle(method: string, handler: BridgeHandler): () => void;
  /**
   * Calls a method the page registered with `nativeBridge.handle`. Rejects on timeout, navigation or teardown, with an
   * `Error` whose `code` is a {@link BridgeErrorCode}.
   */
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

/** `geolocation` and `protectedMedia` (the device id DRM playback needs) are Android only. */
export type PermissionResource = 'camera' | 'microphone' | 'geolocation' | 'protectedMedia';
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

/** What a platform setting can take: what its property or setter accepts. An object is one of the iOS structs. */
export type SettingValue =
  boolean | number | string | null | UIEdgeInsets | CGPoint | CGSize | CGRect;

/** A root's generated keys ({@link IOSSettingKeys}, {@link AndroidSettingKeys}, from the SDK headers) plus, untyped, any other key the platform has. */
type Root<Known> = Known & Record<string, SettingValue | undefined>;

/**
 * WebKit settings by Objective-C property name, applied with Key-Value Coding, so any public property works, including
 * ones this package has never heard of: `{ scrollView: { bounces: false }, webView: { allowsBackForwardNavigationGestures: true } }`.
 * A value must fit the property's type (enums and option sets by raw value; `websiteDataStore` takes `'default'` or
 * `'nonPersistent'`); otherwise the key is skipped with a warning. Read one back with the ref's `get('scrollView.bounces')`.
 */
export type IOSSettings = {
  /** `WKWebViewConfiguration`: read once, when the WKWebView is created; a change recreates the WebView (the page reloads). */
  configuration?: Root<IOSSettingKeys['configuration']>;
  /** `WKPreferences` (`configuration.preferences`), live. */
  preferences?: Root<IOSSettingKeys['preferences']>;
  /** `WKWebpagePreferences` (`configuration.defaultWebpagePreferences`), live from the next navigation. */
  webpagePreferences?: Root<IOSSettingKeys['webpagePreferences']>;
  /** The `WKWebView`, live. */
  webView?: Root<IOSSettingKeys['webView']>;
  /** Its `UIScrollView`, live. */
  scrollView?: Root<IOSSettingKeys['scrollView']>;
};

/**
 * Android settings by setter name without `set`, applied by reflection, so any public setter works, including ones a
 * newer SDK or androidx.webkit adds: `{ settings: { textZoom: 120, algorithmicDarkeningAllowed: true }, webView: { overScrollMode: 2 } }`.
 * A key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning.
 * Read one back with the ref's `get('settings.textZoom')`.
 */
export type AndroidSettings = {
  /** `WebSettings` setters, then static `WebSettingsCompat` ones. */
  settings?: Root<AndroidSettingKeys['settings']>;
  /** `WebView` setters (static and inherited `View` ones too), then `WebViewCompat` ones, then `CookieManager`'s `acceptThirdPartyCookies`. */
  webView?: Root<AndroidSettingKeys['webView']>;
};

/** An event a native hook sent with `emit` or `ask` (README: Native hooks). */
export type NativeEvent = { name: string; payload: Record<string, unknown> };

/** The WebView's own props. The rest of `WebViewProps` is React Native's `ViewProps`. */
type OwnProps = {
  source: WebViewSource;
  /** Platform settings by name; see {@link IOSSettings}. The `userAgent` prop wins over the same key here. */
  ios?: IOSSettings;
  /** Platform settings by name; see {@link AndroidSettings}. The `userAgent` prop wins over the same key here. */
  android?: AndroidSettings;
  /**
   * Replaces the whole user agent (`ios.webView.customUserAgent`, `android.settings.userAgentString`). To append to
   * the default one instead, set `ios.configuration.applicationNameForUserAgent` and, on Android,
   * `android.settings.userAgentString` from `WebView.defaultUserAgent`.
   */
  userAgent?: string;
  injectedScripts?: InjectedScript[];
  navigationRules?: NavigationRule[];
  /** Called only for `ask` rules. Times out after 1 s, then `block`. Without this prop, `ask` is `block`. */
  onNavigationRequest?: (
    request: NavigationRequest
  ) => NavigationAction | Promise<NavigationAction>;
  /** Opens `external` navigations. Default: the system browser or app for the URL. */
  onOpenExternal?: (url: string) => void;
  /** Read when the WebView is created: a change recreates it (the page reloads). */
  bridge?: Bridge;
  /** What the native hooks get as their options (README: Native hooks). Read when the WebView is created, like `bridge`. */
  nativeOptions?: Record<string, unknown>;
  /**
   * An event from a native hook. For an `ask`, the return value (a promise is awaited) is the answer; `undefined` or
   * a throw answers null.
   */
  onNativeEvent?: (event: NativeEvent) => unknown;
  /** Pull down at the top of the page to reload: `UIRefreshControl` on iOS, `SwipeRefreshLayout` on Android. */
  pullToRefresh?: boolean;
  /**
   * iOS: copies `HTTPCookieStorage` (native requests) into the WebView before each `source` load, and the WebView's
   * cookie changes back as they happen. Android needs nothing: `CookieManager` is shared app-wide.
   */
  sharedCookies?: boolean;
  // Page requests: each works without its prop, as described. Passing one takes the request over. They can be added or
  // removed at any time. A native hook that takes the same platform callback comes first.
  /**
   * `<input type="file">` on Android: return `file://` or `content://` URIs, or null to cancel. Without it, the system
   * file chooser opens (it ignores `capture`). iOS always shows WebKit's picker.
   */
  onFileRequest?: (request: FileRequest) => string[] | null | Promise<string[] | null>;
  /**
   * Android: the page entered or left fullscreen (`active`). Fullscreen works without it: the page's view covers the
   * window, the system bars hide and back exits. iOS: WebKit's own fullscreen, not reported.
   */
  onFullscreenChange?: (event: { active: boolean }) => void;
  /**
   * Camera, microphone and, on Android, location and protected media (DRM) for the main frame. Answer true to grant:
   * ask the OS first (expo-camera, expo-location), or the page's request fails anyway. Without it: Android denies; iOS
   * shows WebKit's own prompt, and location always does.
   */
  onPermissionRequest?: (request: PermissionRequestEvent) => boolean | Promise<boolean>;
  /**
   * A download finished ({@link Download}, a file in the app's cache) or failed ({@link DownloadFailure}). Without it,
   * an http(s) download opens externally (`onOpenExternal` or the system browser, without the page's session), and a
   * `data:` or `blob:` one is dropped.
   */
  onDownload?: (result: Download | DownloadFailure) => void;
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
 * They go to the native view.
 */
export type WebViewProps = OwnProps & Omit<ViewProps, keyof OwnProps | 'children'>;

export type WebViewRef = {
  goBack(): void;
  goForward(): void;
  reload(): void;
  stopLoading(): void;
  /**
   * Runs an expression in the page's main frame and awaits it. Resolves with its value through JSON (`null` for what
   * JSON can't encode). Rejects with `ERR_EVALUATE` when it throws or rejects (or, on iOS, before the WebView exists),
   * `navigated` on a new page, or `unavailable` (Android) when the WebView lacks the features it needs.
   */
  evaluate(script: string): Promise<unknown>;
  /**
   * A platform setting read by name, through JSON: `get('scrollView.bounces')` on iOS, `get('settings.textZoom')` on
   * Android (the roots of {@link IOSSettings} and {@link AndroidSettings}; also `websiteDataStore` and `httpCookieStore` on
   * iOS, `cookieManager` and `webStorage` on Android). Rejects with `ERR_NATIVE` for one it can't read.
   */
  get(key: string): Promise<unknown>;
  /**
   * Calls a platform method, `root.method`, and resolves with its result through JSON (README: Platform settings).
   * Android: a public method of `webView` (then `WebViewCompat`'s statics), `cookieManager` or `webStorage`:
   * `call('webView.clearCache', [true])`, `call('cookieManager.removeAllCookies', [null])`. iOS: an Objective-C
   * selector on a root of {@link IOSSettings}, `websiteDataStore` or `httpCookieStore`, the arguments set by the
   * method's signature (`call('scrollView.setContentOffset:animated:', [{ x: 0, y: 100 }, true])`); a selector that
   * ends in a completion handler needs the handler's shape:
   * `call('webView.createPDFWithConfiguration:completionHandler:', [null], { completion: 'valueError' })`. A wrong
   * shape crashes. What the core owns, and private selectors, reject with `ERR_NATIVE`.
   */
  call(
    method: string,
    args?: unknown[],
    options?: { completion?: 'void' | 'value' | 'valueError' | 'error' }
  ): Promise<unknown>;
};

/** What `createWebViewRef()` returns: a ref that outlives the WebViews mounted with it. */
export type WebViewRefObject = {
  /** The mounted WebView's ref, or null while none is mounted. */
  readonly current: WebViewRef | null;
  /** The mounted WebView's navigation state, read synchronously; the initial state while none is mounted. */
  getState(): NavigationState;
  /** Calls `listener` on every state change, including a WebView mounting or unmounting. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};
