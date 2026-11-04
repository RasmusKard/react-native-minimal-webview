import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

import type { BridgeConnection, CONNECTION } from './bridge/createBridge';
import type {
  AndroidSettingKeys,
  CGPoint,
  CGRect,
  CGSize,
  IOSSettingKeys,
  UIEdgeInsets,
} from './platform.generated';

/**
 * What the WebView loads: a URL, or an HTML string.
 * @group WebView
 */
export type WebViewSource =
  | {
      /**
       * The URL to load.
       *
       * A `file://` URL reads only within `readAccessRoot` on iOS; Android needs `android.settings.allowFileAccess`,
       * which lets a `file:` page read any file the app can.
       */
      uri: string;
      /** Sent with the first request only, not on later navigations. */
      headers?: Record<string, string>;
      /**
       * Makes the request a POST with this form-urlencoded body.
       *
       * Its `Content-Type` is `application/x-www-form-urlencoded` unless iOS `headers` set one; Android sends no
       * `headers`.
       * `reload()` sends the POST again; {@link ProcessGoneEvent.recovered | crash recovery} doesn't.
       * @example
       * ```ts
       * const source: WebViewSource = { uri: 'https://example.com/form', body: 'a=1&b=2' };
       * ```
       */
      body?: string;
      /**
       * For a `file://` `uri`, the `file://` directory the page may read, which must contain the file. Without it, or
       * when it isn't a `file:` URL or doesn't contain the file (a warning says so), the file's directory.
       * @ios
       */
      readAccessRoot?: string;
    }
  | {
      /** The page's HTML. */
      html: string;
      /** The page's URL: its relative URLs resolve against it, and it has this origin. Without it, `about:blank`. */
      baseUrl?: string;
    };

/**
 * What happens to a navigation.
 *
 * - `allow`: it loads in place, on iOS a tapped universal link too (instead of opening the app that claims it).
 * - `block`: it is cancelled.
 * - `external`: `onOpenExternal`, or else the system, opens it.
 * @group Navigation
 */
export type NavigationAction = 'allow' | 'block' | 'external';

/**
 * A pattern over a navigation's URL and kind, and what the navigations it matches do.
 *
 * Every field it sets must match; for a list, one matching entry is enough. A field left out matches anything; a flag
 * set to `false` matches only the requests without it.
 * @example
 * ```ts
 * const navigationRules: NavigationRule[] = [
 *   { query: ['gad_source', 'utm_term=google'], action: 'block' }, // gad_source with any value, utm_term only =google
 *   { scheme: ['tel', 'mailto'], action: 'external' },
 *   { host: ['*.example.com'], path: ['/checkout'], action: 'external' }, // shop.example.com/checkouts too
 *   { host: ['example.com', '*.example.com'], action: 'allow' }, // *.example.com alone skips example.com
 * ];
 * ```
 * @group Navigation
 */
export type NavigationRule = {
  /** URL schemes without the `:` (`tel`), exact and case-insensitive. */
  scheme?: string[];
  /**
   * Hosts: exact, or a `*.` suffix wildcard that matches subdomains only, not the domain itself.
   *
   * Case, port, userinfo and a trailing dot are ignored.
   */
  host?: string[];
  /**
   * Path prefixes: plain prefixes of the percent-encoded URL path, not whole segments.
   *
   * A URL without an authority (`myapp:/open`) has the path `/`.
   */
  path?: string[];
  /**
   * Query parameters, percent-encoded as in the URL and case-sensitive: a name matches that parameter whatever its
   * value, and `name=value` only that exact value.
   */
  query?: string[];
  /**
   * The main frame's navigation (true) or an iframe's (false).
   *
   * Android decides only an iframe's non-http(s) navigations, so a `mainFrame: false` rule for http(s) is iOS only.
   */
  mainFrame?: boolean;
  /**
   * A `target=_blank` or `window.open` navigation, always a main-frame one.
   *
   * An allowed one loads in place: there is never a second WebView, so no `window.opener` (a native hook that takes
   * `createWebViewWith` on iOS or `onCreateWindow` on Android owns real popups).
   *
   * One to `data:`, `blob:`, `javascript:`, `about:` or `file:` is always blocked (on Android, WebView may still run a
   * `javascript:` one's script, with the page's origin), and one opened with no URL (`window.open('')`) is decided by
   * the URL the page sends it to within 5 s, and dropped otherwise.
   *
   * One opened without a user gesture reaches the rules only with `javaScriptCanOpenWindowsAutomatically` on
   * (`ios.preferences`, `android.settings`; off by default); otherwise WebKit or WebView drops it unreported.
   */
  newWindow?: boolean;
  /**
   * A user gesture started it.
   *
   * A `location.href` change or `window.open` from a click handler is true on Android, but false on iOS, where only a
   * tapped link is. A redirect of a load the core starts itself (an allowed new window, and on Android an allowed
   * `ask`) is never user-initiated.
   */
  userInitiated?: boolean;
  /**
   * What the navigations it matches do; `ask` puts each to `onNavigationRequest`.
   *
   * On Android, which can't hold a navigation until JS answers, it works only for the main frame (elsewhere it is
   * `block`): the navigation is cancelled, and an allowed one loads again after the answer, without the page's referrer
   * policy or the gesture flag.
   */
  action: NavigationAction | 'ask';
};

/**
 * A navigation an `ask` rule puts to `onNavigationRequest`, or an `external` one to `onOpenExternal`.
 * @group Navigation
 */
export type NavigationRequest = {
  /** The URL it goes to. */
  url: string;
  /** Whether it's the main frame's, not an iframe's. */
  mainFrame: boolean;
  /** Whether it's a new-window navigation ({@link NavigationRule.newWindow}). */
  newWindow: boolean;
  /** Whether a user gesture started it ({@link NavigationRule.userInitiated}). */
  userInitiated: boolean;
};

/**
 * A navigation decision, for `onNavigation`.
 * @group Navigation
 */
export type NavigationEvent = NavigationRequest & {
  /** Without `onOpenExternal`, or when it returns false, an `external` URL that no app opens is reported as `block`. */
  action: NavigationAction;
  /**
   * Index of the matching rule in `navigationRules`, or in {@link defaultNavigationRules} when that is unset; null when
   * no rule decided (none matched, a scheme that always loads in place or is always blocked, or a download opened
   * externally).
   */
  rule: number | null;
};

/**
 * A WebView's navigation state, as native reports it: from `useWebViewState` and `onNavigationStateChange`.
 *
 * While no WebView is mounted it is the initial state: `url` and `title` empty, `pendingUrl` and `outcome` null,
 * `loading`, `canGoBack` and `canGoForward` false, `progress` 0.
 * @group Navigation
 */
export type NavigationState = {
  /**
   * The page on screen: changes on commit and same-document navigation (pushState, replaceState, hash), and stays the
   * old page while a load is in progress.
   *
   * After a failed load, the failed URL. Iframes never change it.
   */
  url: string;
  /**
   * A main-frame load in progress, which may still fail or be blocked.
   *
   * Iframes never change it. Always null on Android with a WebView older than 146.
   */
  pendingUrl: string | null;
  title: string;
  loading: boolean;
  /** From 0 to 1. */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * How the last main-frame load ended; null while one is loading, and before the first.
   *
   * - `failed`: a network or SSL error, or a renderer crash, cut it off.
   * - `cancelled`: it never showed a page (a stop before the response, a download, a 204, a redirect the rules blocked,
   *   a load a newer one replaced); a stop after the page arrived is `cancelled` on iOS but `finished` on Android, and
   *   a 204 is `finished` on iOS 17.
   *
   * An HTTP error status (404) is `finished`: the site's page shows, and `onError` gets an `http` error. On Android
   * with a WebView older than 146, a load that never commits changes nothing here.
   */
  outcome: 'finished' | 'failed' | 'cancelled' | null;
};

/**
 * A main-frame error, for `onError`.
 *
 * - `network` and `ssl`: the load failed, no page arrived; an SSL error always cancels the load. `code` is the
 *   platform's own: on iOS the `NSError` code (an `NSURLError*` constant, usually), on Android `WebViewClient.ERROR_*`
 *   for `network` and `SslError.SSL_*` for `ssl`.
 * - `http`: the response had an HTTP error status (400+), and the site's own error page shows.
 * @group Events
 */
export type LoadErrorEvent =
  | { kind: 'network' | 'ssl'; url: string; code: number; description: string }
  | { kind: 'http'; url: string; statusCode: number };

/**
 * The renderer process died, for `onProcessGone`.
 * @group Events
 */
export type ProcessGoneEvent = {
  /**
   * Whether the renderer crashed (true) or the system killed it for memory (false); null on iOS, where WebKit doesn't
   * say.
   *
   * Test it with `=== true` or `=== false`, not as a condition.
   */
  didCrash: boolean | null;
  /**
   * Whether the core reloads the page: on iOS in place; on Android in a new WebView, once the app is in the foreground
   * and the view on screen, with the history restored unless the `source` page was on screen, and with the props
   * applied but not what `call` set.
   *
   * False while a POST `source` is on screen, which, as in a browser, isn't sent again unasked (`reload()` sends it),
   * and after more than 3 crashes in 60 s, counted for the whole app on Android, until the next
   * {@link WebViewRef.reload | reload()} (on iOS also a `source` change); pull-to-refresh doesn't lift it.
   */
  recovered: boolean;
};

/**
 * Runs at document start, before any page script and before the DOM is parsed.
 * @example
 * ```ts
 * const script: InjectedScript = {
 *   code: "addEventListener('DOMContentLoaded', () => document.body.classList.add('in-app'));",
 *   origins: ['https://example.com'],
 * };
 * ```
 * @group Scripts
 */
export type InjectedScript = {
  code: string;
  /**
   * Runs it in every frame, iframes included.
   * @default `false`
   */
  allFrames?: boolean;
  /**
   * The origins whose frames run it, in the syntax of {@link BridgeOptions.allowedOrigins}. Each frame is matched by
   * its own `location.origin`, so a listed page's iframes from other origins don't run it; about:blank and srcdoc
   * frames have their parent's origin. `'*'` matches every origin, opaque ones (`data:`, sandboxed frames) and
   * `file:` included; `[]` matches none.
   *
   * Without `'*'` in the list, the code runs inside a function: its top-level `let`, `const`, `class`, `function` and
   * `var` stay local to it, so put what the page should see on `window`. An invalid rule throws when the WebView
   * renders.
   */
  origins: string[];
};

/**
 * Who sent a call or event: the page's origin as `location.origin` writes it (`https://example.com:8443`), checked by
 * native code, not taken from the page.
 *
 * Every allowed origin gets the same trust; a handler scopes itself with this.
 * @group Bridge
 */
export type BridgeSender = { origin: string };

/**
 * Answers a bridge call: the return value (a promise is awaited) is the result.
 *
 * A throw or rejection rejects the call with the {@link ErrorCode} `handler_error` and the error's message.
 * @group Bridge
 */
export type BridgeHandler<Params = unknown, Result = unknown> = (
  params: Params,
  sender: BridgeSender
) => Result | Promise<Result>;

/**
 * The methods either side may call, for `createBridge<Methods>`.
 *
 * One map covers both directions, so a method is named once, whichever side handles it. With a map, `handle` and
 * `call` take only its methods: another name doesn't compile. A `type`, not an `interface` (an interface has no index
 * signature, so it doesn't satisfy `Record`).
 * @example
 * ```ts
 * type Methods = { share: { params: { url: string }; result: boolean } };
 * const bridge = createBridge<Methods>({ allowedOrigins: ['https://example.com'] });
 * ```
 * @group Bridge
 */
export type BridgeMethodMap = Record<string, { params?: unknown; result?: unknown }>;
/**
 * The events either side may emit, for `createBridge<Methods, Events>`.
 *
 * With a map, `emit` and `on` take only its events: another name doesn't compile.
 * @example
 * ```ts
 * type Events = { themeChanged: 'light' | 'dark' };
 * const bridge = createBridge<Methods, Events>({ allowedOrigins: ['https://example.com'] });
 * ```
 * @group Bridge
 */
export type BridgeEventMap = Record<string, unknown>;

/**
 * A promise-based RPC channel to `window.nativeBridge` in the page.
 *
 * Attach it with the `bridge` prop. Handlers and listeners belong to the bridge, not to a WebView: they stay across
 * unmounts. Messages have no size limit.
 *
 * What it sends waits for the page's `DOMContentLoaded`, so the handlers and listeners of the page's synchronous and
 * deferred scripts are in place, and never reaches a later page, even one on the same origin. The page's own calls
 * don't wait: one made before React Native has registered its method rejects with `not_found`.
 *
 * A call or event made while no WebView is mounted with the bridge waits the same way. A call's timeout runs
 * meanwhile, and only the latest 1000 are kept: an older call rejects with `unavailable`.
 * Unmounting rejects the calls in flight with `navigated`.
 *
 * The page's `window.nativeBridge` has the same four methods, `call(method, params?, { timeoutMs? })`, `handle`, `emit`
 * and `on`, and its calls reject with a {@link CodedError}.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export type Bridge<
  Methods extends BridgeMethodMap = BridgeMethodMap,
  Events extends BridgeEventMap = BridgeEventMap,
> = {
  /**
   * Answers `nativeBridge.call(method, params)` from the page.
   *
   * One handler per method: a later one replaces it. Returns an unsubscribe function, which removes only this handler.
   */
  handle<M extends keyof Methods & string>(
    method: M,
    handler: BridgeHandler<Methods[M]['params'], Methods[M]['result']>
  ): () => void;
  /**
   * Calls a method the page registered with `nativeBridge.handle`.
   *
   * Rejects with a {@link CodedError}: `timeout`, `not_found`, `handler_error`, `navigated` or `unavailable`.
   * `timeoutMs` overrides the bridge's for this call, and one that isn't 0 or more rejects with a plain `RangeError`.
   */
  call<M extends keyof Methods & string>(
    method: M,
    params?: Methods[M]['params'],
    options?: { timeoutMs?: number }
  ): Promise<Methods[M]['result']>;
  /**
   * Fires an event the page listens to with `nativeBridge.on`.
   *
   * Dropped if the page goes away before it arrives, or if the page has no listener for it.
   */
  emit<E extends keyof Events & string>(event: E, payload?: Events[E]): void;
  /**
   * Listens to `nativeBridge.emit(event, payload)` from the page. Returns an unsubscribe function.
   *
   * A listener that throws is reported as an unhandled promise rejection, and the event's later listeners don't run.
   */
  on<E extends keyof Events & string>(
    event: E,
    listener: (payload: Events[E], sender: BridgeSender) => void
  ): () => void;
  /** What `<WebView>` attaches to. Only `createBridge` sets it, so a hand-made or mock `Bridge` doesn't type-check. */
  readonly [CONNECTION]: BridgeConnection;
};

/**
 * The options of `createBridge`.
 * @group Bridge
 */
export type BridgeOptions = {
  /**
   * The origins whose pages get `window.nativeBridge`, main frame only: an origin, a `*.` wildcard that matches
   * subdomains only (not the domain itself), an IP literal, or `'*'` for any origin, opaque ones too.
   *
   * Each takes an optional port. http or https, no path, ASCII (punycode) hosts; case is ignored, and a missing port
   * means 80 or 443.
   * @example
   * ```ts
   * createBridge({ allowedOrigins: ['https://example.com', 'https://*.example.com', 'http://[::1]:8080'] });
   * ```
   */
  allowedOrigins: string[];
  /**
   * Per-call timeout in milliseconds, also the default for the page's `nativeBridge.call`; `0` or `Infinity` means
   * none.
   * @default `10000`
   */
  timeoutMs?: number;
};

/**
 * An `<input type="file">`.
 * @android
 * @group Page requests
 */
export type FileRequest = {
  /** Its `accept` list as written: MIME types and extensions (`.pdf`). */
  accept: string[];
  /** Its `multiple` attribute. */
  multiple: boolean;
  /** Its `capture` attribute: the page wants the camera. */
  capture: boolean;
};

/**
 * A device resource a page can ask for.
 *
 * `geolocation` and `protectedMedia` (the device id DRM playback needs, Widevine) are Android only: on iOS, location
 * always shows WebKit's own prompt, and FairPlay asks nothing.
 * @group Page requests
 */
export type PermissionResource = 'camera' | 'microphone' | 'geolocation' | 'protectedMedia';
/**
 * A page's permission request, for `onPermissionRequest`.
 *
 * Only the main frame asks (on Android, which doesn't name the frame, any frame of the top page's origin); other
 * frames, and a page with an opaque origin (`data:`, a sandboxed frame), are denied without asking.
 * @group Page requests
 */
export type PermissionRequest = {
  /** The requesting page's origin, as `location.origin` writes it; every `file:` page is `file://`. */
  origin: string;
  resources: PermissionResource[];
};

/**
 * A finished download.
 * @group Page requests
 */
export type Download = {
  ok: true;
  /** A `file://` in the app's cache (iOS: the temporary directory), which the core never deletes. */
  uri: string;
  /**
   * A plain file name, no path, but the page chose it, like the content and `mimeType`: don't open the file as
   * trusted.
   */
  filename: string;
  mimeType: string;
  /** The server URL the file came from; `null` when the page generated it (`data:` or `blob:` URL). */
  url: string | null;
};

/**
 * A download that could not be saved; `kind` says why.
 *
 * - `network`: connecting or reading the response failed, or a redirect was refused.
 * - `http`: the response had an error status (Android only: iOS saves what the server sent).
 * - `data`: the content: a bad `data:` or `blob:` URL, the page not reading its blob, an unsupported scheme, or
 *   (Android) a file above 100 MB or a `blob:` URL the main frame can't read (a cross-origin iframe's, or one already
 *   revoked).
 * @group Page requests
 */
export type DownloadFailure =
  | {
      /** Tells it from a {@link Download}. */
      ok: false;
      kind: 'network' | 'data';
      filename: string;
      /** As in {@link Download}. */
      url: string | null;
      description: string;
    }
  | { ok: false; kind: 'http'; filename: string; url: string; statusCode: number };

/**
 * What `onDownload` gets.
 * @group Page requests
 */
export type DownloadResult = Download | DownloadFailure;

/**
 * What a platform setting can take: what its property or setter accepts. An object is one of the iOS structs.
 * @group Platform settings
 */
export type SettingValue =
  boolean | number | string | null | UIEdgeInsets | CGPoint | CGSize | CGRect;

/**
 * A settings root: its generated keys ({@link IOSSettingKeys}, {@link AndroidSettingKeys}, from the SDK headers), so a
 * misspelled key fails to compile, and `other` for the keys they lack.
 * @group Platform settings
 */
export type SettingsRoot<Keys> = Keys & {
  /**
   * Any other key the platform has (a newer SDK's, one the headers don't list), untyped. It is set as if it were at
   * the root; a generated key can't go here.
   */
  other?: Record<string, SettingValue | undefined> & { [K in keyof Keys]?: never };
};

/**
 * The private WebKit settings {@link IOSSettings} takes besides {@link IOSSettingKeys}, both off by default.
 * @ios
 * @group Platform settings
 */
export type IOSPrivateSettingKeys = {
  /** `WKWebViewConfiguration` */
  configuration: {
    /** Lets a `file:` page read any URL. */
    allowUniversalAccessFromFileURLs?: boolean;
  };
  /** `WKPreferences` */
  preferences: {
    /** Lets a `file:` page read other `file:` URLs. */
    allowFileAccessFromFileURLs?: boolean;
  };
};

/**
 * WebKit settings by Objective-C property name.
 *
 * Any public property works, including ones this package has never heard of (under a root's `other`). The keys the SDK
 * headers list autocomplete, with their `@since`, as do the {@link IOSPrivateSettingKeys}. A value must fit the
 * property's type: enums and option sets by raw value (from {@link IOSConstants}), structs as objects, a `UIColor` as
 * `#rrggbb` or `#rrggbbaa`, an `NSURL` as a string, `websiteDataStore` as `'default'` or `'nonPersistent'`.
 *
 * A key that doesn't fit, a private (`_`) one, or one the device's iOS lacks (its `@since` is newer) is skipped with a
 * warning; nothing here can crash the app. So is a property UIKit declares without runtime metadata, such as
 * `webView.opaque`: set it with `call('webView.setOpaque:', [false])`.
 *
 * A root's default keys are the package's, and yours go over them; a key the package doesn't set keeps WebKit's
 * default, and a key you remove goes back to the value it had before you first set it. The ref's
 * {@link WebViewRef.get | get} and {@link WebViewRef.call | call} take these roots, plus `websiteDataStore` and
 * `httpCookieStore`.
 *
 * WebKit has no mixed-content setting: it applies its own policy.
 * @example
 * ```tsx
 * <WebView
 *   source={{ uri: 'https://example.com' }}
 *   ios={{
 *     configuration: { dataDetectorTypes: IOSConstants.DataDetectorTypes.link },
 *     scrollView: { bounces: false, contentInset: { top: 0, left: 0, bottom: 80, right: 0 } },
 *   }}
 * />
 * ```
 * @ios
 * @see [Platform settings example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#platform-settings)
 * @group Platform settings
 */
export type IOSSettings = {
  /**
   * `WKWebViewConfiguration`: read once, when the WKWebView is created; a change recreates the WebView (the page
   * reloads and the navigation state starts over). It is a copy, so `call` on it changes nothing.
   * @default `{ allowsInlineMediaPlayback: true }`
   */
  configuration?: SettingsRoot<
    IOSSettingKeys['configuration'] & IOSPrivateSettingKeys['configuration']
  >;
  /** `WKPreferences` (`configuration.preferences`), live. */
  preferences?: SettingsRoot<IOSSettingKeys['preferences'] & IOSPrivateSettingKeys['preferences']>;
  /** `WKWebpagePreferences` (`configuration.defaultWebpagePreferences`), live from the next navigation. */
  webpagePreferences?: SettingsRoot<IOSSettingKeys['webpagePreferences']>;
  /**
   * The `WKWebView`, live.
   *
   * `customUserAgent: null` is WebKit's default user agent, with `applicationNameForUserAgent` appended.
   * @default `{ customUserAgent: null, inspectable: __DEV__ }`
   */
  webView?: SettingsRoot<IOSSettingKeys['webView']>;
  /** Its `UIScrollView`, live. */
  scrollView?: SettingsRoot<IOSSettingKeys['scrollView']>;
};

/**
 * Android settings by setter name without `set`.
 *
 * Any public setter works, including ones a newer SDK or androidx.webkit adds (under a root's `other`). The keys the
 * SDK lists autocomplete, with their `@since`; the constants are in {@link AndroidConstants}.
 *
 * A key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning;
 * nothing here can crash the app. A root's default keys are the package's, and yours go over them; a key the package
 * doesn't set keeps the platform's default (`acceptThirdPartyCookies` is off, for one). A key you remove goes back to
 * the value it had before you first set it; one with no getter, such as `geolocationEnabled`, keeps its value until the
 * WebView is recreated, with a warning.
 *
 * The ref's {@link WebViewRef.get | get} and {@link WebViewRef.call | call} take these roots, plus `cookieManager` and
 * `webStorage`; a key is the getter's name without `get` or `is`.
 * @example
 * ```tsx
 * <WebView
 *   source={{ uri: 'https://example.com' }}
 *   android={{
 *     settings: { textZoom: 120, cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE },
 *     webView: { overScrollMode: 2 },
 *   }}
 * />
 * ```
 * @android
 * @see [Platform settings example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#platform-settings)
 * @group Platform settings
 */
export type AndroidSettings = {
  /**
   * `WebSettings` setters, then static `WebSettingsCompat` ones.
   *
   * Each new WebView starts with `javaScriptEnabled`, `domStorageEnabled`, `supportMultipleWindows` and
   * `builtInZoomControls` on; `allowFileAccess`, `allowContentAccess`, `displayZoomControls` and
   * `downloadFaviconsEnabled` off; `mixedContentMode` `MIXED_CONTENT_NEVER_ALLOW`; and, with WebView 146 and newer,
   * `backForwardCacheEnabled` on. `userAgentString: null` is WebView's default user agent.
   * @default `{ userAgentString: null }`
   */
  settings?: SettingsRoot<AndroidSettingKeys['settings']>;
  /**
   * `WebView` setters (static and inherited `View` ones too), then `WebViewCompat` ones, then `CookieManager`'s
   * `acceptThirdPartyCookies`.
   *
   * `webContentsDebuggingEnabled` is refused: it is process-wide, set with
   * {@link AndroidWebView.setWebContentsDebuggingEnabled}.
   */
  webView?: SettingsRoot<AndroidSettingKeys['webView']>;
};

/**
 * An event a native hook sent with `emit` or `ask`.
 * @typeParam N - The event's name, to type one hook's events.
 * @typeParam P - Its payload.
 * @example
 * ```ts
 * type PageLoaded = HookEvent<'pageLoaded', { count: number }>;
 * ```
 * @group Native hooks
 */
export type HookEvent<N extends string = string, P = Record<string, unknown>> = {
  /** The event's name, relative to the extension's key: `pageLoaded` for `'pageCounter.pageLoaded'`. */
  name: N;
  /** What the hook sent with it. */
  payload: P;
};

/**
 * A native hook's JS side, for {@link WebViewProps.extensions}: its key, its options, and what takes its events.
 *
 * A package with a native hook exports a function that returns one, so that an app turns the hook on by putting it in
 * `extensions`.
 * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 * @group Native hooks
 */
export type HookExtension = {
  /**
   * The key the hook is registered under.
   *
   * A key no hook is registered under warns: pass a one-platform hook's extension on that platform only. Two extensions
   * with one key warn in development, and the later one wins.
   */
  key: string;
  /**
   * What the hook gets as its options. Null or false switches the hook off, as does leaving its extension out of
   * `extensions`: it stays attached and gets null, but the core routes none of its delegates, clients or listeners,
   * drops its events, answers its asks with null, and rejects `ref.hook` calls to its handlers with `not_found`.
   * Undefined means `true`. Turning it on again gives it the new options.
   * @default `true`
   */
  options?: unknown;
  /**
   * Each of the hook's events, with `name` relative to `key`: it goes to the extension whose key its name starts with
   * (`'<key>.'`; the longest key, when several do), and one no extension owns is dropped. For an `ask`, the return
   * value (a promise is awaited) is the answer, and `undefined` answers null. `signal` is set only for an `ask`, and
   * aborts when native stops waiting for the answer: an ask has no timeout, but one still open when the page goes away
   * is answered null.
   *
   * The latest `onEvent` always takes the events: a render with new handlers sends native nothing.
   */
  onEvent?: (event: HookEvent, signal?: AbortSignal) => unknown;
};

/**
 * A fullscreen change, for `onFullscreenChange`.
 * @android
 * @group Events
 */
export type FullscreenChangeEvent = { active: boolean };

/**
 * Why a ref method or a bridge call rejected. Each code means the same on every method that rejects with it.
 *
 * - `timeout`: a bridge call got no answer in time.
 * - `not_found`: nothing by that name answers: no bridge handler for the method, no attached hook `name` that is on
 *   and handles `method`, or no such root, key, method (on Android, one that takes these arguments) or selector (on
 *   this OS or WebView version too; a private `_` key of an iOS `get` too), or a malformed path.
 * - `handler_error`: the handler of a bridge call, on either side, failed; the `message` is its error's.
 * - `script_error`: `evaluate`'s script threw, rejected or didn't parse.
 * - `native_error`: the platform refused or failed the call: a member the core owns (or a private selector for an iOS
 *   `call`), a key `get` can't read, wrong arguments (iOS), a completion handler `call` can't await, a native
 *   exception or `NSError`, or a result JSON can't carry (`NaN`).
 * - `navigated`: the page or the WebView went away while the call was pending (a navigation, a crash, an unmount), so
 *   it may have run: retry only what is safe to repeat.
 * - `unavailable`: the call didn't run: the WebView is gone or not mounted yet, is being rebuilt after its renderer
 *   died (Android), the bridge's queue was full and dropped it, or lacks the feature (the method's TSDoc names the
 *   Android System WebView it needs, or a compat method this WebView doesn't support).
 *
 * A programming error, such as an argument of the wrong type, can reject with a plain `TypeError` instead.
 * @group WebView
 */
export type ErrorCode =
  | 'timeout'
  | 'not_found'
  | 'handler_error'
  | 'script_error'
  | 'native_error'
  | 'navigated'
  | 'unavailable';

/**
 * What a ref method or a bridge call rejects with: an `Error` whose `code` says why.
 * @group WebView
 */
export type CodedError = Error & { code: ErrorCode };

/**
 * What the WebView loads, its settings, and the callbacks for its events and the page's requests.
 *
 * The ones from React Native's `ViewProps` (`style`, `testID`, `nativeID`, the accessibility props, layout and touch
 * events) go to the native view.
 *
 * Every `on…` callback is read when its event or request comes, so adding, changing or removing one applies to the
 * next, and a request without one gets the default described on its prop. One that answers a request and throws (or
 * rejects) is logged with `console.error` and gives the refusing answer: `onNavigationRequest` `block`,
 * `onOpenExternal` null (the core opens nothing), `onFileRequest` cancel, `onPermissionRequest` deny, an extension's
 * `onEvent` null.
 *
 * The `signal` such a callback gets aborts when native stops waiting for its answer (the page moved on, crashed or
 * unmounted), and a late answer is dropped.
 *
 * JS dialogs (`alert`, `confirm`, `prompt`) and HTTP auth have no prop. iOS shows a `UIAlertController` titled with the
 * frame's host, one at a time (one that comes while another shows is cancelled), and Android WebView's own dialogs. An
 * auth challenge is cancelled on Android, and gets WebKit's default handling on iOS: without a stored credential, the
 * site's 401 page shows. `dialogs` and `basicAuthCredential` of
 * `@react-native-minimal-webview/extensions` take them over, or a native hook does.
 * @group WebView
 */
export interface WebViewProps extends Omit<ViewProps, 'children'> {
  /**
   * What to load.
   *
   * A new `source` loads at once, unless it equals the loaded one field by field: that loads nothing, even after the
   * page navigated away.
   */
  source: WebViewSource;
  /**
   * WebKit settings by property name; see {@link IOSSettings}.
   * @ios
   */
  ios?: IOSSettings;
  /**
   * Android settings by setter name; see {@link AndroidSettings}.
   * @android
   */
  android?: AndroidSettings;
  /**
   * Replaces the whole user agent, over `ios.webView.customUserAgent` and `android.settings.userAgentString`. Without
   * it, those keys apply; unset, they are the platform's own user agent.
   *
   * To append to the default one instead, set `ios.configuration.applicationNameForUserAgent` and, on Android,
   * `android.settings.userAgentString` to `AndroidWebView.defaultUserAgent` plus your suffix.
   *
   * A change applies from the next navigation.
   */
  userAgent?: string;
  /**
   * Scripts to run at document start, before the page's own, in the frames picked by each script's `allFrames` and
   * `origins`.
   *
   * A change applies from the next navigation. On Android with a WebView older than 101 they don't run (a warning says
   * so, once per process).
   */
  injectedScripts?: InjectedScript[];
  /**
   * Which navigations load in place, open externally or are blocked, decided natively; the first matching rule wins,
   * and with no match the navigation is blocked.
   *
   * Unset, the rules are {@link defaultNavigationRules}; `[]` is no rules, so every navigation they decide is blocked.
   *
   * `about:`, `blob:`, `data:` and `javascript:` always load in place.
   *
   * The `source` load, reloads and back/forward skip the rules; a redirect of the `source` load doesn't, nor on Android
   * a redirect of a reload or back/forward. The rules never see a form POST, on either platform: it loads in place, and
   * one to a new window loads in place on iOS, and on Android isn't shown (the request may still reach the server).
   *
   * An `external` `intent:` URL (Android) opens only as a browsable intent, without its explicit component or selector;
   * when no app handles it, an http(s) `S.browser_fallback_url` goes through the rules (main frame, no user gesture),
   * and the `intent:` itself is reported as `block`.
   *
   * A change applies from the next navigation.
   *
   * A native hook can take these decisions, defaults included: see `WebViewContext.clients` (Android) and
   * `navigationDelegates` (iOS).
   * @example
   * ```tsx
   * <WebView
   *   source={{ uri: 'https://example.com' }}
   *   // myapp: opens externally even without a user gesture; everything else as by default
   *   navigationRules={[{ scheme: ['myapp'], action: 'external' }, ...defaultNavigationRules]}
   * />
   * ```
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
   */
  navigationRules?: readonly NavigationRule[];
  /**
   * Decides each navigation an `ask` rule matches, within 1 s.
   *
   * A late, missing or other answer is `block`, as is one still pending when another page commits; `signal` aborts at
   * the timeout and at that commit. Without this prop, `ask` is `block`. Until the next commit, a URL it allowed isn't
   * asked again on a redirect back to it (Android), or when the same kind of frame loads it again (iOS).
   */
  onNavigationRequest?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => NavigationAction | Promise<NavigationAction>;
  /**
   * Opens `external` navigations, every one, an Android `intent:` URL included, before `onNavigation` reports them.
   *
   * Return false (a promise is awaited) to hand it back: the core then opens it as it does without this prop, an
   * `intent:`'s fallback URL included. Any other answer, `undefined` too, means you opened it. When `signal` aborts,
   * nothing opens it.
   *
   * Without this prop, the system browser or app for the URL opens it, without asking `canOpenURL` first, so no
   * `LSApplicationQueriesSchemes` (iOS) or `<queries>` (Android) entries are needed.
   */
  onOpenExternal?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => boolean | void | Promise<boolean | void>;
  /**
   * The bridge to the page, from `createBridge`.
   *
   * Read when the WebView is created: another bridge recreates it (the page reloads and the navigation state starts
   * over), so make it once (`useMemo`). A bridge serves one mounted WebView at a time: attaching it to a second throws.
   *
   * On Android with a WebView older than 101 there is no bridge: calls reject with `unavailable`, and a warning says
   * so, once per process.
   */
  bridge?: Bridge;
  /**
   * The native hooks to turn on, as {@link HookExtension}s: a package with a native hook exports a function that
   * returns one.
   *
   * A false, null or undefined entry is left out, so `on && extension(…)` switches one on and off; see
   * {@link HookExtension.options} for what off means. A hook attaches when its key first appears, and a later change of
   * its `options` reaches it live, without recreating the WebView. A key turned on after the WebView was created
   * attaches its hook then, unless the hook has a `configure` step or its own WebView class (`webViewClass`,
   * `webViewFactory`): that one attaches only when the WebView is created, and a warning says so.
   * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
   */
  extensions?: readonly (HookExtension | false | null | undefined)[];
  /**
   * Pull down at the top of the page to reload: `UIRefreshControl` on iOS, `SwipeRefreshLayout` on Android, where a
   * pull inside a scrolled inner scroller (`overflow: auto`) scrolls it instead.
   *
   * It reloads as {@link WebViewRef.reload | reload()} does, a POST `source` included. A change applies at once.
   * @default `false`
   */
  pullToRefresh?: boolean;
  /**
   * Copies `HTTPCookieStorage` (native requests) into the WebView before each `source` load, which waits for it, and
   * the WebView's cookie changes, deletions included, back as they happen.
   *
   * Android needs nothing: `CookieManager` is shared app-wide, and flushed when the app goes to the background.
   * @default `false`
   * @ios
   */
  sharedCookies?: boolean;
  /**
   * Answers `<input type="file">` with `file://` or `content://` URIs, or null to cancel.
   *
   * Without it, the system file chooser opens, one at a time for the whole app, and ignores `capture`: a request while
   * one is open is cancelled, and if the chooser's activity died without returning a result, so is every request until
   * the app restarts.
   *
   * iOS always shows WebKit's picker, which needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
   *
   * Until the answer settles, the page's next file request waits.
   * @android
   */
  onFileRequest?: (
    request: FileRequest,
    signal: AbortSignal
  ) => string[] | null | Promise<string[] | null>;
  /**
   * The page entered or left fullscreen (`active`).
   *
   * Fullscreen works without it: the page's view covers the window, the system bars hide and back exits. iOS shows
   * WebKit's own fullscreen, not reported.
   * @android
   */
  onFullscreenChange?: (event: FullscreenChangeEvent) => void;
  /**
   * Camera, microphone and, on Android, location and protected media (DRM) for the main frame.
   *
   * Answer true to grant, having asked the OS first (expo-camera, expo-location): without OS permission the page's
   * request fails anyway. On iOS, true also skips WebKit's own prompt.
   *
   * Without this prop, Android denies and iOS shows WebKit's prompt (location always does). iOS needs
   * `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`, Android the `CAMERA` and `RECORD_AUDIO` manifest
   * permissions. Android keeps a location answer until the page changes.
   *
   * Anything but true denies. `signal` also aborts when Android withdraws the request. Until the answer settles, the
   * page's next request of the same kind waits.
   */
  onPermissionRequest?: (
    request: PermissionRequest,
    signal: AbortSignal
  ) => boolean | Promise<boolean>;
  /**
   * A download finished ({@link Download}) or failed ({@link DownloadFailure}).
   *
   * With this prop the core saves the file: iOS downloads it in the page's session; Android fetches it again with the
   * host's cookies (whatever their SameSite) and the page's user agent. That fetch sends no POST body, `source` headers
   * or HTTP auth, so a download that needs them can fail, or save the server's login page as the file, and it fails
   * above 100 MB, on a redirect off https, and for `blob:` on a WebView older than 83.
   *
   * Without this prop, an http(s) download opens externally (`onOpenExternal` or the system browser, without the page's
   * session), and a `data:` or `blob:` one is dropped. A PDF is a download on Android; iOS shows it inline.
   *
   * On iOS a file response is a download only in the main frame; an `<a download>` link is one from any frame.
   *
   * On Android a native hook's `WebViewContext.onDownloadStart` is offered each download first, and one it takes
   * reaches neither this prop nor the external fallback.
   */
  onDownload?: (result: DownloadResult) => void;
  /**
   * Every navigation the rules, or their defaults, decided.
   *
   * Not reported: the `source` load, reloads, back/forward, and a navigation a native hook decides.
   */
  onNavigation?: (event: NavigationEvent) => void;
  /**
   * Every change to the navigation state.
   *
   * Changes that arrive together may be combined into one call; `loading` going true is never combined away, so a load
   * that starts and fails at once still reports both.
   */
  onNavigationStateChange?: (state: NavigationState) => void;
  /**
   * A main-frame load failed, or got an HTTP error status.
   *
   * After a failed load iOS keeps the page before it on screen, and Android shows WebView's own error page. On Android
   * with a WebView older than 146, an SSL error on a back/forward load isn't reported.
   *
   * A renderer crash isn't reported here: it makes the cut-off load's `outcome` `failed` and calls `onProcessGone`.
   */
  onError?: (event: LoadErrorEvent) => void;
  /**
   * The renderer died; see {@link ProcessGoneEvent} for the recovery.
   *
   * Android's WebViews share one renderer, so each of them reports its death.
   */
  onProcessGone?: (event: ProcessGoneEvent) => void;
  /**
   * `loading` went true.
   *
   * On Android with a WebView older than 146, a load that never commits fires neither this nor `onLoadEnd`.
   */
  onLoadStart?: (state: NavigationState) => void;
  /** `loading` went false: `state.outcome` says how the load ended. */
  onLoadEnd?: (state: NavigationState) => void;
  /**
   * Gets the {@link WebViewRef}.
   *
   * Give each mounted WebView its own ref: one shared by two points at the last mounted (with a warning in
   * development), and can turn null when either unmounts.
   */
  ref?: Ref<WebViewRef>;
}

/**
 * The methods a WebView's `ref` gets: navigation, scripts, and platform and hook calls.
 *
 * A handle kept after its WebView unmounted is safe to call: the navigation methods do nothing, and `evaluate`, `get`,
 * `call` and `hook` reject with `unavailable`. One still pending when the WebView unmounts rejects with `navigated`.
 *
 * Those four wait up to about a second for a WebView that has just mounted (on Android, a call from the parent's first
 * effect can come before the view exists), then reject with `unavailable`; in the background they don't wait.
 * @group WebView
 */
export type WebViewRef = {
  /**
   * Goes back one page; does nothing unless `canGoBack`.
   *
   * On Android, as Chrome's back button, it also skips the history entries a page added without a user gesture
   * (`pushState`, a hash change) and the page that added them.
   */
  goBack(): void;
  /** Goes forward one page; does nothing unless `canGoForward`. */
  goForward(): void;
  /**
   * Reloads the page; after a failed load, retries the failed URL.
   *
   * Sends a POST `source` again, and lifts the limit on {@link ProcessGoneEvent.recovered | crash recovery}.
   */
  reload(): void;
  /** Stops the load: its `outcome` is `cancelled`, or on Android `finished` once the page has arrived. */
  stopLoading(): void;
  /**
   * Runs an expression (not statements) in the page's main frame and awaits it.
   *
   * Resolves with its value through JSON: `null` for what JSON can't encode (a function, `NaN`, a cycle), a `Date` as
   * its ISO string. The value is the page's, so treat it as page data. Rejects with a {@link CodedError}:
   * `script_error`, `navigated` or `unavailable`. There is no timeout: a page can hold a call until it navigates. On
   * Android with a WebView older than 83 it rejects with `unavailable`.
   */
  evaluate(script: string): Promise<unknown>;
  /**
   * Reads a platform setting, `root.key`, and resolves with its value through JSON, as {@link WebViewRef.call | call}
   * converts results.
   *
   * The roots and keys are those of {@link IOSSettings} and {@link AndroidSettings}.
   *
   * It reads the WebView as it is when the call arrives: a navigation doesn't reject it. Rejects with a
   * {@link CodedError}: `not_found`, `unavailable` (Android) or `native_error`.
   * @example
   * ```ts
   * const bounces = await ref.current?.get('scrollView.bounces'); // iOS
   * const textZoom = await ref.current?.get('settings.textZoom'); // Android
   * ```
   */
  get(key: string): Promise<unknown>;
  /**
   * Calls a platform method, `root.method`, and resolves with its result through JSON. It acts on the WebView as it is
   * when the call arrives: a navigation doesn't reject it.
   *
   * The roots are those of {@link IOSSettings} and {@link AndroidSettings}. On Android `method` is a public method of
   * the root's object; on iOS an Objective-C selector.
   *
   * Rejects with a {@link CodedError}: `not_found`, `unavailable` (Android) or `native_error`.
   *
   * The core owns, and so rejects:
   *
   * - iOS: every selector that loads, navigates (`setInteractionState:` too), runs a script, starts a download or sets
   *   a delegate, and private (`_`), KVC, `willChange…`, `didChange…`, `performSelector`, `init…`, `copy…`,
   *   `mutable…`, `new…` and reference-counting selectors.
   * - Android (in `get` too): the loads, navigations, clients, JavaScript interfaces, web message listeners,
   *   document-start scripts, the touch, scroll-change and navigation listeners, `destroy`, `removeAllViews`,
   *   `pauseTimers`, `resumeTimers`, `evaluateJavascript` and remote debugging
   *   ({@link AndroidWebView.setWebContentsDebuggingEnabled}).
   *
   * A trailing completion handler (iOS) or `ValueCallback` (Android) is left out of `args`: the call resolves with what
   * it reports, or on iOS rejects with its error. On iOS, a selector whose completion handler isn't in this package's
   * SDK headers, or reports something other than an object, an error or an integer, rejects with `native_error`. On
   * Android, a method that takes `args` as they are wins over one that also takes a callback, and a `null` in the
   * callback's place passes none.
   *
   * One mistake the signature can't catch crashes the app: on iOS an object argument of the wrong class, and on Android
   * a `null` listener or callback other than the trailing `ValueCallback`, once WebView calls it. For a method that
   * takes another object, write a native hook.
   *
   * @param args The method's arguments: booleans, numbers, strings and `null`. On iOS also the structs as objects, and
   * `{ set: [...] }`, `{ date: seconds }`, `{ data: base64 }` or `{ cookie: properties }` for an `NSSet`, `NSDate`,
   * `NSData` or `NSHTTPCookie`; any other string stays an `NSString`. A cookie's properties are `NSHTTPCookie`'s keys:
   * `Name`, `Value`, `Domain` and `Path` are required; `Max-Age` (seconds, as a string), `Secure`, `HttpOnly` and
   * `SameSite` are some of the optional ones. A tag that can't make its object (`{ data }` that isn't base64, a
   * `{ cookie }` without a required key) rejects with `native_error`.
   * @returns The result: primitives, strings, and collections of them; on iOS also the structs as objects, an `NSURL`
   * as a string, an `NSDate` as seconds, `NSData` as base64, a `UIImage` as a base64 PNG and an `NSHTTPCookie` as its
   * properties (`Expires` in seconds). Any other object is `null`.
   * @example
   * ```ts
   * await ref.current?.call('webView.clearCache', [true]); // Android
   * await ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 100 }, true]); // iOS
   * ```
   */
  call(method: string, args?: unknown[]): Promise<unknown>;
  /**
   * Calls the `method` handler the native hook `name` registered with `context.handle`, with `args`, and resolves with
   * its reply; both cross as JSON.
   *
   * The reply converts as {@link WebViewRef.call | call}'s results do. Rejects with a {@link CodedError}: `not_found`
   * or `native_error`. A navigation or a crash doesn't settle a call whose handler hasn't replied; only an unmount
   * does.
   */
  hook(name: string, method: string, args?: unknown[]): Promise<unknown>;
};

/**
 * What `createWebViewRef()` returns: a ref that outlives the WebViews mounted with it.
 * @group WebView
 */
export type WebViewRefObject = {
  /** The mounted WebView's ref, or null while none is mounted. */
  readonly current: WebViewRef | null;
  /** The mounted WebView's navigation state, read synchronously. */
  getState(): NavigationState;
  /**
   * Calls `listener` on every state change, including a WebView mounting or unmounting, and returns the unsubscribe.
   *
   * A subscriber stays across remounts.
   */
  subscribe(listener: () => void): () => void;
};
