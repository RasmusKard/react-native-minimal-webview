import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

import type { BridgeConnection, CONNECTION } from './bridge/createBridge';
import type { BridgeErrorCode } from './bridge/protocol';
import type {
  AndroidSettingKeys,
  CGPoint,
  CGRect,
  CGSize,
  IOSSettingKeys,
  UIEdgeInsets,
} from './platform.generated';

/** What the WebView loads: a URL, or an HTML string. */
export type WebViewSource =
  | {
      /**
       * A `file://` URL gets read access to its directory on iOS; Android needs `android.settings.allowFileAccess`,
       * which lets a `file:` page read any file the app can.
       */
      uri: string;
      /** Sent with the first request only, not on later navigations. */
      headers?: Record<string, string>;
      /**
       * Makes the request a POST with this form-urlencoded body (`a=1&b=2`). iOS sends `headers` with it and sets
       * `Content-Type` when they don't; Android's `postUrl` sends neither. `reload()` sends the POST again; crash
       * recovery doesn't (`onProcessGone` reports `recovered: false`).
       */
      body?: string;
    }
  | { html: string; baseUrl?: string };

/**
 * What happens to a navigation. `allow`: it loads in place, on iOS a tapped universal link too (instead of opening the
 * app that claims it). `block`: it is cancelled. `external`: `onOpenExternal`, or else the system, opens it.
 */
export type NavigationAction = 'allow' | 'block' | 'external';

/** One navigation rule. Every field it sets must match; for a list, one matching entry is enough. */
export type NavigationRule = {
  /** Exact, case-insensitive: `['tel', 'mailto']`. */
  scheme?: string[];
  /**
   * Exact, or a `*.` suffix wildcard that matches subdomains only: `['*.example.com']` does not match `example.com`.
   * Case, port, userinfo and a trailing dot are ignored.
   */
  host?: string[];
  /**
   * Plain prefixes of the percent-encoded URL path: `['/checkout']` also matches `/checkouts`. A URL without an
   * authority (`myapp:/open`) has the path `/`.
   */
  path?: string[];
  /**
   * Query parameters, percent-encoded as in the URL and case-sensitive: `gad_source` matches a parameter with that
   * name, whatever its value; `utm_term=google` matches only that exact value.
   */
  query?: string[];
  /** Android decides only an iframe's non-http(s) navigations, so a `mainFrame: false` rule for http(s) is iOS only. */
  mainFrame?: boolean;
  /**
   * `target=_blank` or `window.open`, a main-frame navigation. An allowed one loads in place: there is never a second
   * WebView, so no `window.opener`. One to `data:`, `blob:`, `javascript:`, `about:` or `file:` is always blocked, and
   * one opened with no URL (`window.open('')`) is decided when the page first sends it to one, or dropped when that
   * doesn't happen within 5 s.
   */
  newWindow?: boolean;
  /**
   * A user gesture started it (Android `hasGesture()`, iOS `.linkActivated`). A `location.href` change or `window.open`
   * from a click handler is true on Android, but false on iOS, where only a tapped link is.
   */
  userInitiated?: boolean;
  /**
   * `ask` calls `onNavigationRequest`. On Android it works only for the main frame (elsewhere it is `block`), and an
   * allowed navigation is loaded again, without the page's referrer policy or the gesture flag.
   */
  action: NavigationAction | 'ask';
};

/** A navigation an `ask` rule puts to `onNavigationRequest`. */
export type NavigationRequest = {
  url: string;
  mainFrame: boolean;
  newWindow: boolean;
  userInitiated: boolean;
};

/** A navigation decision, for `onNavigation`. */
export type NavigationEvent = NavigationRequest & {
  /** Without `onOpenExternal`, an `external` URL that no app opens is reported as `block`. */
  action: NavigationAction;
  /**
   * Index of the matching rule in `navigationRules`, or null when no rule did (a default, or a download opened
   * externally).
   */
  rule: number | null;
};

/** A WebView's navigation state, as native reports it: from `useWebViewState` and `onNavigationStateChange`. */
export type NavigationState = {
  /**
   * The page on screen: changes on commit and same-document navigation (pushState, replaceState, hash), and stays the
   * old page while a load is in progress. After a failed load, the failed URL. Iframes never change it.
   */
  url: string;
  /**
   * A main-frame load in progress, which may still fail or be blocked. Iframes never change it. Always null on Android
   * with a WebView older than 146.
   */
  pendingUrl: string | null;
  title: string;
  loading: boolean;
  /** From 0 to 1. */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * How the last main-frame load ended; null while one is loading, and before the first. `failed`: a network or SSL
   * error, or a renderer crash, cut it off. `cancelled`: it never showed a page (a stop before the response, a
   * download, a 204, a redirect the rules blocked, a load a newer one replaced); a stop after the page arrived is
   * `cancelled` on iOS but `finished` on Android, and a 204 is `finished` on iOS 17.5. An HTTP error status (404) is
   * `finished`: the site's page shows, and `onError` gets an `http` error. On Android with a WebView older than 146,
   * a load that never commits changes nothing here.
   */
  outcome: 'finished' | 'failed' | 'cancelled' | null;
};

/**
 * A main-frame error. `network` and `ssl`: the load failed, no page arrived (`code` is the platform's error code); an
 * SSL error always cancels the load. `http`: the response had an HTTP error status (400+), and the site's own error
 * page shows.
 */
export type LoadErrorEvent =
  | { kind: 'network' | 'ssl'; url: string; code: number; description: string }
  | { kind: 'http'; url: string; statusCode: number };

/** The renderer process died, for `onProcessGone`. */
export type ProcessGoneEvent = {
  /** False when the system killed the renderer for memory (Android). Always true on iOS: WebKit doesn't say. */
  didCrash: boolean;
  /**
   * The core reloads the page: on iOS in place; on Android in a new WebView, once the app is in the foreground and the
   * view on screen, with the history restored unless the `source` page was on screen, and with the props applied but
   * not what `call` set. False while a POST `source` is
   * on screen (`reload()` sends it again), and after more than 3 crashes in 60 s, counted for the whole app on Android,
   * until the next `reload()` (on iOS also a `source` change).
   */
  recovered: boolean;
};

/**
 * Runs at document start, before any page script. Code for when the DOM is parsed goes in
 * `addEventListener('DOMContentLoaded', …)`.
 */
export type InjectedScript = {
  code: string;
  /**
   * `false` runs it in every frame, iframes included.
   * @default true
   */
  mainFrameOnly?: boolean;
};

/**
 * Who sent a call or event: the page's origin as `location.origin` writes it (`https://example.com:8443`), checked by
 * native code, not taken from the page. Every allowed origin gets the same trust; a handler scopes itself with this.
 */
export type BridgeSender = { origin: string };

/**
 * Answers a bridge call: the return value (a promise is awaited) is the result. A throw or rejection rejects the call
 * with `handler_error` and the error's message.
 */
export type BridgeHandler<Params = unknown, Result = unknown> = (
  params: Params,
  sender: BridgeSender
) => Result | Promise<Result>;

/** What a bridge call rejects with: an `Error` whose `code` says why. */
export type BridgeCallError = Error & { code: BridgeErrorCode };

/**
 * The methods either side may call, for `createBridge<Methods>`:
 * `{ share: { params: { url: string }; result: boolean } }`. One map covers both directions, so a method is named once,
 * whichever side handles it. A `type`, not an `interface` (an interface has no index signature, so it doesn't satisfy
 * `Record`).
 */
export type BridgeMethodMap = Record<string, { params?: unknown; result?: unknown }>;
/** The events either side may emit, for `createBridge<Methods, Events>`: `{ themeChanged: 'light' | 'dark' }`. */
export type BridgeEventMap = Record<string, unknown>;

/**
 * A promise-based RPC channel to `window.nativeBridge` in the page. Attach it with the `bridge` prop. What it sends
 * waits for the page's `DOMContentLoaded`, so the handlers and listeners of the page's synchronous and deferred scripts
 * are in place, and never reaches a later page, even one on the same origin; the page's own calls work earlier.
 * Messages have no size limit. The page's `window.nativeBridge` has the same four methods, `call(method, params?,
 * { timeoutMs? })`, `handle`, `emit` and `on`, and its calls reject with an `Error` whose `code` is a
 * {@link BridgeErrorCode}.
 * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#the-bridge
 */
export type Bridge<
  Methods extends BridgeMethodMap = BridgeMethodMap,
  Events extends BridgeEventMap = BridgeEventMap,
> = {
  /**
   * Answers `nativeBridge.call(method, params)` from the page. One handler per method: a later one replaces it.
   * Returns an unsubscribe function, which removes only this handler.
   */
  handle<M extends keyof Methods & string>(
    method: M,
    handler: BridgeHandler<Methods[M]['params'], Methods[M]['result']>
  ): () => void;
  /**
   * Calls a method the page registered with `nativeBridge.handle`. Rejects with a {@link BridgeCallError}, with
   * `navigated` when the page navigates or crashes, or the WebView unmounts, before it answers: the page may have
   * handled the call already, so retry only calls that are safe to repeat. `timeoutMs` overrides the bridge's for this
   * call; `0` or `Infinity` means none, and one that isn't 0 or more rejects with a plain `RangeError`.
   */
  call<M extends keyof Methods & string>(
    method: M,
    params?: Methods[M]['params'],
    options?: { timeoutMs?: number }
  ): Promise<Methods[M]['result']>;
  /** Fires an event the page listens to with `nativeBridge.on`. Dropped if the page goes away before it arrives. */
  emit<E extends keyof Events & string>(event: E, payload?: Events[E]): void;
  /** Listens to `nativeBridge.emit(event, payload)` from the page. Returns an unsubscribe function. */
  on<E extends keyof Events & string>(
    event: E,
    listener: (payload: Events[E], sender: BridgeSender) => void
  ): () => void;
  /** What `<WebView>` attaches to. Only `createBridge` sets it, so a hand-made or mock `Bridge` doesn't type-check. */
  readonly [CONNECTION]: BridgeConnection;
};

/** The options of `createBridge`. */
export type BridgeOptions = {
  /**
   * The origins whose pages get `window.nativeBridge`, main frame only: `'*'` (any origin, opaque ones too),
   * `'https://example.com'`, `'https://*.example.com'` (subdomains only, not `example.com`) or an IP literal
   * (`'http://[::1]:8080'`), each with an optional port. http or https, no path, ASCII (punycode) hosts; case is
   * ignored, and a missing port means 80 or 443.
   */
  allowedOrigins: string[];
  /**
   * Per-call timeout in milliseconds; `0` or `Infinity` means none.
   * @default 10000
   */
  timeoutMs?: number;
};

/**
 * An `<input type="file">`. `accept` is its `accept` list as written, MIME types and extensions (`.pdf`). `capture` is
 * its `capture` attribute: the page wants the camera.
 * @platform android
 */
export type FileRequest = { accept: string[]; multiple: boolean; capture: boolean };

/**
 * `geolocation` and `protectedMedia` (the device id DRM playback needs, Widevine) are Android only: on iOS, location
 * always shows WebKit's own prompt, and FairPlay asks nothing.
 */
export type PermissionResource = 'camera' | 'microphone' | 'geolocation' | 'protectedMedia';
/**
 * `origin` is the requesting page's, as `location.origin` writes it; every `file:` page is `file://`. Only the main
 * frame asks (on Android, which doesn't name the frame, any frame of the top page's origin); other frames, and a page
 * with an opaque origin (`data:`, a sandboxed frame), are denied without asking.
 */
export type PermissionRequest = { origin: string; resources: PermissionResource[] };

/**
 * A finished download: `uri` is a `file://` in the app's cache (iOS: the temporary directory), which the core never
 * deletes. `url` is the server URL the file came from; `null` when the page generated it (`data:` or `blob:` URL).
 * `filename` is a plain file name, no path, but the page chose it, like the content and `mimeType`: don't open the file
 * as trusted.
 */
export type Download = {
  ok: true;
  uri: string;
  filename: string;
  mimeType: string;
  url: string | null;
};

/**
 * A download that could not be saved (a bad data: or blob: URL, a network or HTTP error). `url` as in {@link Download}.
 * `ok` tells it from a {@link Download}.
 */
export type DownloadFailure = { ok: false; filename: string; url: string | null; reason: string };

/** What a platform setting can take: what its property or setter accepts. An object is one of the iOS structs. */
export type SettingValue =
  boolean | number | string | null | UIEdgeInsets | CGPoint | CGSize | CGRect;

/**
 * A settings root: its generated keys ({@link IOSSettingKeys}, {@link AndroidSettingKeys}, from the SDK headers) plus,
 * untyped, any other key the platform has.
 */
export type SettingsRoot<Keys> = Keys & Record<string, SettingValue | undefined>;

/**
 * WebKit settings by Objective-C property name, set with Key-Value Coding, so any public property works, including ones
 * this package has never heard of: `{ scrollView: { bounces: false } }`. The keys the SDK headers list autocomplete,
 * with their `@since`. A value must fit the property's type: enums and option sets by raw value
 * (`WK.DataDetectorTypes.link`), structs as objects (`contentInset: { top, left, bottom, right }`), a `UIColor` as
 * `#rrggbb` or `#rrggbbaa`, an `NSURL` as a string, `websiteDataStore` as `'default'` or `'nonPersistent'`. A key that
 * doesn't fit, or a private (`_`) one, is skipped with a warning; nothing here can crash the app. A root's `@default`
 * keys are the package's, and yours go over them. Read one back with the ref's `get('scrollView.bounces')`.
 * @platform ios
 * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#platform-settings
 */
export type IOSSettings = {
  /**
   * `WKWebViewConfiguration`: read once, when the WKWebView is created; a change recreates the WebView (the page
   * reloads and the navigation state starts over). The default lets a `<video playsinline>` play inline. The private
   * `allowUniversalAccessFromFileURLs` is accepted, for react-native-webview parity: it lets a `file:` page read any URL.
   * @default { allowsInlineMediaPlayback: true }
   */
  configuration?: SettingsRoot<IOSSettingKeys['configuration']>;
  /**
   * `WKPreferences` (`configuration.preferences`), live. The private `allowFileAccessFromFileURLs` is accepted, for
   * react-native-webview parity: it lets a `file:` page read other `file:` URLs.
   */
  preferences?: SettingsRoot<IOSSettingKeys['preferences']>;
  /** `WKWebpagePreferences` (`configuration.defaultWebpagePreferences`), live from the next navigation. */
  webpagePreferences?: SettingsRoot<IOSSettingKeys['webpagePreferences']>;
  /**
   * The `WKWebView`, live.
   * @default { customUserAgent: null, inspectable: __DEV__ }
   */
  webView?: SettingsRoot<IOSSettingKeys['webView']>;
  /** Its `UIScrollView`, live. */
  scrollView?: SettingsRoot<IOSSettingKeys['scrollView']>;
};

/**
 * Android settings by setter name without `set`, applied by reflection, so any public setter works, including ones a
 * newer SDK or androidx.webkit adds: `{ settings: { textZoom: 120 }, webView: { overScrollMode: 2 } }`. The keys the
 * SDK lists autocomplete, with their `@since`; the constants are in `Android` (`Android.WebSettings.LOAD_NO_CACHE`). A
 * key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning;
 * nothing here can crash the app. A root's `@default` keys are the package's, and yours go over them. Read one back
 * with the ref's `get('settings.textZoom')`.
 * @platform android
 * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#platform-settings
 */
export type AndroidSettings = {
  /**
   * `WebSettings` setters, then static `WebSettingsCompat` ones. Each new WebView starts with `javaScriptEnabled`,
   * `domStorageEnabled`, `supportMultipleWindows` and `builtInZoomControls` on; `allowFileAccess`,
   * `allowContentAccess`, `displayZoomControls` and `downloadFaviconsEnabled` off; `mixedContentMode`
   * `MIXED_CONTENT_NEVER_ALLOW`; and, with WebView 146 and newer, `backForwardCacheEnabled` on.
   * @default { userAgentString: null }
   */
  settings?: SettingsRoot<AndroidSettingKeys['settings']>;
  /**
   * `WebView` setters (static and inherited `View` ones too), then `WebViewCompat` ones, then `CookieManager`'s
   * `acceptThirdPartyCookies`. `webContentsDebuggingEnabled` is process-wide.
   * @default { webContentsDebuggingEnabled: __DEV__ }
   */
  webView?: SettingsRoot<AndroidSettingKeys['webView']>;
};

/**
 * An event a native hook sent with `emit` or `ask`, named `'<hook key>.<event name>'`. `N` and `P` type one hook's
 * events: `HookEvent<'pageCounter.pageLoaded', { count: number }>`.
 */
export type HookEvent<N extends string = string, P = Record<string, unknown>> = {
  name: N;
  payload: P;
};

/**
 * `onFullscreenChange`'s event.
 * @platform android
 */
export type FullscreenChangeEvent = { active: boolean };

/**
 * Why a ref method rejected. `script_error`: `evaluate`'s script threw, rejected or didn't parse. `native_error`: the
 * platform refused or failed a `get`, `call` or `hook`. `navigated`: the page went away before `evaluate` finished.
 * `unavailable`: the WebView lacks the features it needs (`evaluate` on an Android System WebView older than 83), is gone, or is being
 * rebuilt after its renderer died (Android, while the app is in the background or the view detached).
 * `hook_not_handled`: no attached hook handles the `hook` method.
 */
export type WebViewErrorCode =
  'script_error' | 'native_error' | 'navigated' | 'unavailable' | 'hook_not_handled';

/** What a ref method rejects with: an `Error` whose `code` says why. */
export type CodedError = Error & { code: WebViewErrorCode };

/**
 * The WebView's props. The ones from React Native's `ViewProps` (`style`, `testID`, `nativeID`, the accessibility
 * props, layout and touch events) go to the native view. JS dialogs (`alert`, `confirm`, `prompt`) and HTTP auth have
 * no prop: iOS shows a `UIAlertController` titled with the frame's host, one at a time, and Android WebView's own
 * dialogs; an auth challenge is declined, so the site's 401 page shows. A native hook takes them over (`HookDialogs`
 * and `HookAuth` in `example/modules/sample-extension`).
 */
export interface WebViewProps extends Omit<ViewProps, 'children'> {
  /**
   * What to load. A new `source` loads at once, unless it equals the loaded one field by field: that loads nothing,
   * even after the page navigated away.
   */
  source: WebViewSource;
  /**
   * WebKit settings by property name; see {@link IOSSettings}. A key you remove keeps its value until the WebView is
   * recreated, unless the package sets it (`inspectable`, `customUserAgent`): that one goes back to the package's
   * default. The `userAgent` prop wins over the same key here.
   * @platform ios
   */
  ios?: IOSSettings;
  /**
   * Android settings by setter name; see {@link AndroidSettings}. A key you remove keeps its value until the WebView is
   * recreated, unless the package sets it (`webContentsDebuggingEnabled`, `userAgentString`): that one goes back to the
   * package's default. The `userAgent` prop wins over the same key here.
   * @platform android
   */
  android?: AndroidSettings;
  /**
   * Replaces the whole user agent (`ios.webView.customUserAgent`, `android.settings.userAgentString`). To append to
   * the default one instead, set `ios.configuration.applicationNameForUserAgent` and, on Android,
   * `android.settings.userAgentString` to `WebView.defaultUserAgent` plus your suffix.
   */
  userAgent?: string;
  /**
   * Scripts to run at document start, before the page's own, on every page and origin the WebView visits (and with
   * `mainFrameOnly: false` in cross-origin iframes): guard with `location.origin`. A change applies from the next
   * navigation. On Android with a WebView older than 101 they don't run (a warning says so, once per process).
   */
  injectedScripts?: InjectedScript[];
  /**
   * Which navigations load in place, open externally or are blocked, decided natively; the first matching rule wins,
   * and with no match the navigation is blocked. With no rules (or `[]`), http(s) loads in place, `file:` is blocked,
   * and other schemes open externally from the main frame and are blocked from a subframe. `about:`, `blob:`, `data:`
   * and `javascript:` always load in place. The `source` load, reloads and back/forward skip the rules; a redirect of
   * the `source` load doesn't, nor on Android a redirect of a reload or back/forward. The rules never see a form POST,
   * on either platform: it loads in place, and one to a new window loads in place on iOS and doesn't load on Android.
   * An `external` `intent:` URL (Android) opens only as a browsable intent, without its explicit component or selector;
   * when no app handles it, its `S.browser_fallback_url` goes through the rules and the `intent:` itself is reported as
   * `block`.
   * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#navigation-rules
   */
  navigationRules?: NavigationRule[];
  /**
   * Answers `ask` rules within 1 s. A late, missing or other answer is `block`, as is one still pending when another
   * page commits, and `signal` then aborts. Without this prop, `ask` is `block`. Until the next commit, a URL it
   * allowed isn't asked again on a redirect back to it (Android), or when the same kind of frame loads it again (iOS).
   */
  onNavigationRequest?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => NavigationAction | Promise<NavigationAction>;
  /**
   * Opens `external` navigations, every one, an Android `intent:` URL included (its fallback URL is not loaded).
   * Default: the system browser or app for the URL.
   */
  onOpenExternal?: (url: string) => void;
  /**
   * The bridge to the page, from `createBridge`. Read when the WebView is created: another bridge recreates it (the
   * page reloads and the navigation state starts over), so make it once (`useMemo`). A bridge serves one mounted
   * WebView at a time: attaching it to a second throws.
   */
  bridge?: Bridge;
  /**
   * Each native hook's value by its key. A key whose value is not null, undefined or false when the WebView is created
   * attaches its hook, and a later change reaches that hook live, without recreating the WebView. A key added later
   * attaches nothing (a warning says so), so a hook you switch on and off keeps its key, with the switch in its value.
   * A key no hook is registered under warns: pass a one-platform hook's key on that platform only.
   * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#native-hooks
   */
  hookOptions?: Record<string, unknown>;
  /**
   * An event from a native hook. For an `ask`, the return value (a promise is awaited) is the answer; `undefined` or a
   * throw answers null. `signal` is set only for an `ask`, and aborts when native stops waiting for the answer: an ask
   * has no timeout, but one still open when the page goes away is answered null.
   */
  onHookEvent?: (event: HookEvent, signal?: AbortSignal) => unknown;
  /**
   * Pull down at the top of the page to reload: `UIRefreshControl` on iOS, `SwipeRefreshLayout` on Android, where a
   * pull inside a scrolled inner scroller (`overflow: auto`) scrolls it instead.
   * @default false
   */
  pullToRefresh?: boolean;
  /**
   * Copies `HTTPCookieStorage` (native requests) into the WebView before each `source` load, which waits for it, and
   * the WebView's cookie changes, deletions included, back as they happen. Android needs nothing: `CookieManager` is
   * shared app-wide, and flushed when the app goes to the background.
   * @platform ios
   * @default false
   */
  sharedCookies?: boolean;
  /**
   * Answers `<input type="file">` with `file://` or `content://` URIs, or null to cancel. Without it, the system file
   * chooser opens, one at a time for the whole app, and ignores `capture`: a request while one is open is cancelled,
   * and after a chooser that never returns a result, so is every request until the app restarts. iOS always shows
   * WebKit's picker, which needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. `signal` aborts when
   * native stops waiting (the page moved on, crashed or unmounted), and a late answer is dropped; until it settles, the
   * page's next file request waits.
   * @platform android
   */
  onFileRequest?: (
    request: FileRequest,
    signal: AbortSignal
  ) => string[] | null | Promise<string[] | null>;
  /**
   * The page entered or left fullscreen (`active`). Fullscreen works without it: the page's view covers the window, the
   * system bars hide and back exits. iOS shows WebKit's own fullscreen, not reported.
   * @platform android
   */
  onFullscreenChange?: (event: FullscreenChangeEvent) => void;
  /**
   * Camera, microphone and, on Android, location and protected media (DRM) for the main frame. Answer true to grant,
   * having asked the OS first (expo-camera, expo-location): without OS permission the page's request fails anyway. On
   * iOS, true also skips WebKit's own prompt. Without this prop, Android denies and iOS shows WebKit's prompt (location
   * always does). Android keeps a location answer until the page changes. `signal` aborts when native stops waiting
   * (the page moved on, crashed or unmounted, or Android withdrew the request), and a late answer is dropped; until it
   * settles, the page's next request of the same kind waits.
   */
  onPermissionRequest?: (
    request: PermissionRequest,
    signal: AbortSignal
  ) => boolean | Promise<boolean>;
  /**
   * A download finished ({@link Download}) or failed ({@link DownloadFailure}). With this prop the core saves the file:
   * iOS downloads it in the page's session; Android fetches it again with the host's cookies (whatever their SameSite)
   * and the page's user agent. That fetch sends no POST body, `source` headers or HTTP auth, so such a download can
   * fail or save a login page, and it fails above 100 MB, on a redirect off https, and for `blob:` on a WebView older
   * than 83. Without this prop, an http(s) download opens externally (`onOpenExternal` or the system browser, without
   * the page's session), and a `data:` or `blob:` one is dropped. A PDF is a download on Android; iOS shows it inline.
   */
  onDownload?: (result: Download | DownloadFailure) => void;
  /**
   * Every navigation the rules, or their defaults, decided. Not reported: the `source` load, reloads, back/forward, and
   * a navigation a native hook decides.
   */
  onNavigation?: (event: NavigationEvent) => void;
  /** Every change to the navigation state. Changes within one frame are combined into one call. */
  onNavigationStateChange?: (state: NavigationState) => void;
  /**
   * A main-frame load failed, or got an HTTP error status. On Android with a WebView older than 146, an SSL error on a
   * back/forward load isn't reported.
   */
  onError?: (event: LoadErrorEvent) => void;
  /**
   * The renderer died; see {@link ProcessGoneEvent} for the recovery. Android's WebViews share one renderer, so each of
   * them reports its death.
   */
  onProcessGone?: (event: ProcessGoneEvent) => void;
  /**
   * `loading` went true. On Android with a WebView older than 146, a load that never commits fires neither this nor
   * `onLoadEnd`.
   */
  onLoadStart?: (state: NavigationState) => void;
  /** `loading` went false: `state.outcome` says how the load ended. */
  onLoadEnd?: (state: NavigationState) => void;
  /**
   * Gets the {@link WebViewRef}. A ref object (`useRef`, `createRef`, `createWebViewRef`) also works with
   * `useWebViewState`. Give each mounted WebView its own ref: with two, the last mounted wins (with a warning in
   * development) until it unmounts.
   */
  ref?: Ref<WebViewRef>;
}

/**
 * A WebView's ref. A handle kept after its WebView unmounted is safe to call: the navigation methods do nothing, and
 * `evaluate`, `get`, `call` and `hook` reject with `unavailable`.
 */
export type WebViewRef = {
  /**
   * Goes back one page, when `canGoBack`. On Android, as Chrome's back button, it also skips the history entries a page
   * added without a user gesture (`pushState`, a hash change) and the page that added them.
   */
  goBack(): void;
  /** Goes forward one page, when `canGoForward`. */
  goForward(): void;
  /**
   * Reloads the page; after a failed load, retries the failed URL. Sends a POST `source` again, and resets the crash
   * guard that stops {@link ProcessGoneEvent.recovered | crash recovery}.
   */
  reload(): void;
  /** Stops the load: its `outcome` is `cancelled`, or on Android `finished` once the page has arrived. */
  stopLoading(): void;
  /**
   * Runs an expression (not statements) in the page's main frame and awaits it. Resolves with its value through JSON:
   * `null` for what JSON can't encode (a function, `NaN`, a cycle), a `Date` as its ISO string. The value is the
   * page's, so treat it as page data. Rejects with a {@link CodedError}: `script_error`, with the error's message, when
   * the script throws, rejects or doesn't parse; `navigated` when the page goes away first; `unavailable` on Android
   * with a WebView older than 83. There is no timeout: a page can hold a call until it navigates (an Android `blob:`
   * download, which reads the blob this way, gives up after 30 s).
   */
  evaluate(script: string): Promise<unknown>;
  /**
   * A platform setting read by name, through JSON as {@link WebViewRef.call | call} converts results:
   * `get('scrollView.bounces')` on iOS, `get('settings.textZoom')` on Android. The roots are those of
   * {@link IOSSettings} and {@link AndroidSettings}, plus `websiteDataStore` and `httpCookieStore` on iOS and
   * `cookieManager` and `webStorage` on Android. On Android, `textZoom` reads `getTextZoom()`, `isTextZoom()` or a
   * non-void `textZoom()`. Rejects with `native_error` for one it can't read, or that the core owns.
   */
  get(key: string): Promise<unknown>;
  /**
   * Calls a platform method, `root.method`, and resolves with its result through JSON. Android: a public method of
   * `settings` (then `WebSettingsCompat`'s statics), `webView` (then `WebViewCompat`'s), `cookieManager` or
   * `webStorage`: `call('webView.clearCache', [true])`. iOS: an Objective-C selector on a root of {@link IOSSettings},
   * `websiteDataStore` or `httpCookieStore`: `call('scrollView.setContentOffset:animated:', [{ x: 0, y: 100 }, true])`.
   *
   * Rejects with `native_error` for an unknown method, a wrong argument count, an argument that doesn't fit, a method
   * that raises, a result JSON can't carry (iOS: `NaN`), and what the core owns: on iOS every selector that loads,
   * navigates, runs a script, starts a download or sets a delegate, and private (`_`), KVC, KVO, `performSelector`,
   * `init…`, `copy…`, `mutable…`, `new…` and reference-counting selectors; on Android (in `get` too) the loads,
   * navigations, clients, JavaScript interfaces, web message listeners, document-start scripts, `destroy`,
   * `removeAllViews`, `pauseTimers`, `resumeTimers` and `evaluateJavascript`. On iOS two mistakes the signature can't
   * catch crash the app: a wrong `completion` shape, and an object argument of the wrong class; for a method that takes
   * another object, write a native hook.
   *
   * @param args The method's arguments. On iOS they are converted by its signature: booleans, numbers, strings, the
   * structs as objects, `null` for nil, and `{ set: [...] }`, `{ date: seconds }`, `{ data: base64 }` or
   * `{ cookie: properties }` for an `NSSet`, `NSDate`, `NSData` or `NSHTTPCookie`. A cookie's properties are
   * `NSHTTPCookie`'s keys: `Name`, `Value`, `Domain` and `Path` are required; `Max-Age` (seconds, as a string),
   * `Secure`, `HttpOnly` and `SameSite` are some of the optional ones. A tag that can't make its object (`{ data }`
   * that isn't base64, a `{ cookie }` without a required key) rejects with `native_error`.
   * @param options `completion` (iOS) is the shape of the selector's trailing completion handler: `'void'` for `(void)`
   * resolves `null`; `'value'` for `(id)` resolves the value; `'valueError'` for `(id, NSError *)` resolves the value
   * or rejects with the error; `'error'` for `(NSError *)` resolves `null` or rejects with the error.
   * @returns On iOS: numbers, strings, an `NSURL` as a string, an `NSDate` as seconds, `NSData` as base64, a `UIImage`
   * as a base64 PNG, the structs as objects, an `NSHTTPCookie` as its properties (`Expires` in seconds), and arrays,
   * sets and dictionaries of them. On Android: primitives, strings, and lists and maps of them. Any other object is
   * `null`.
   */
  call(
    method: string,
    args?: unknown[],
    options?: { completion?: 'void' | 'value' | 'valueError' | 'error' }
  ): Promise<unknown>;
  /**
   * Calls the `method` handler the native hook `name` registered with `context.handle`, with `args`, and resolves with
   * its reply; both cross as JSON. Rejects with `hook_not_handled` when no attached hook `name` handles `method`, or
   * `native_error` when the reply can't cross as JSON. A handler that never replies leaves the promise pending: nothing
   * settles it on navigation, a crash or unmount.
   */
  hook(name: string, method: string, args?: unknown[]): Promise<unknown>;
};

/** What `createWebViewRef()` returns: a ref that outlives the WebViews mounted with it. */
export type WebViewRefObject = {
  /** The mounted WebView's ref, or null while none is mounted. */
  readonly current: WebViewRef | null;
  /** The mounted WebView's navigation state, read synchronously; the initial state while none is mounted. */
  getState(): NavigationState;
  /**
   * Calls `listener` on every state change, including a WebView mounting or unmounting; a subscriber stays across
   * remounts. Returns the unsubscribe.
   */
  subscribe(listener: () => void): () => void;
};
