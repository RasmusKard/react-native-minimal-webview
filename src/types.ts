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
 * @see [Local files example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#local-files)
 * @group WebView
 */
export type WebViewSource =
  | {
      /**
       * The URL to load.
       *
       * A `file://` URL:
       *
       * - iOS: reads only within `readAccessRoot`.
       * - Android: needs `android.settings.allowFileAccess`, which lets a `file:` page read any file the app can.
       */
      uri: string;
      /**
       * Sent when the core loads the `source`: its first load, and a reload (`reload()` or pull-to-refresh) or crash
       * recovery that loads the `source` again. The page's later navigations don't send them.
       */
      headers?: Record<string, string>;
      /**
       * Makes the request a POST with this form-urlencoded body.
       *
       * Its `Content-Type` is `application/x-www-form-urlencoded` unless iOS `headers` set one; Android ignores
       * `headers` for a POST.
       *
       * `reload()` sends the POST again; {@link ProcessGoneEvent.recovered | crash recovery} doesn't.
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
 * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
 * @group Navigation
 */
export type NavigationRule = {
  /** URL schemes without the `:` (`tel`), exact and case-insensitive. */
  scheme?: string[];
  /**
   * Hosts: exact, or a `*.` suffix wildcard that matches subdomains only, not the domain itself.
   *
   * Case, port, userinfo and a trailing dot are ignored. An internationalized domain matches only in its ASCII form:
   * `xn--mnchen-3ya.de`, not `münchen.de`.
   */
  host?: string[];
  /**
   * Prefixes of the percent-encoded URL path, not whole segments.
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
   * - Always blocked: one to `data:`, `blob:`, `javascript:`, `file:` or an `about:` URL other than `about:blank` (on
   *   Android, WebView may still run a `javascript:` one's script, with the page's origin).
   * - Opened with no URL (`window.open('')`) or to `about:blank`: decided by the URL the page sends it to within 5 s,
   *   and dropped otherwise.
   * - Opened without a user gesture: reaches the rules only with `javaScriptCanOpenWindowsAutomatically` on
   *   (`ios.preferences`, `android.settings`; off by default); otherwise WebKit or WebView drops it unreported.
   */
  newWindow?: boolean;
  /**
   * A user gesture started it: the user's tap, click or key press.
   *
   * - Android: WebView's flag (`hasGesture()`, `onCreateWindow`'s `isUserGesture`), Chromium's user activation, which
   *   a tap that doesn't scroll, a click or a key press gives the page for up to 5 s. Any navigation the page starts in
   *   that time is true: a `location.href` change or `window.open` from a click handler, a timer's, a link a script
   *   clicks.
   * - iOS: true only for a link activation (`<a>`, `<area>`, `target=_blank` too) within 1 s after a tap on the WebView
   *   that scrolls and zooms nothing. A link a script clicks within that second is true too.
   *     - False: a `location.href` change or `window.open`, from a click handler too, a link activated from a
   *       hardware keyboard, and a form submission, a tapped one and its redirect included.
   *     - A tapped link's redirect is true only within that second.
   *     - VoiceOver and Switch Control activate a link without a touch: while either runs, every link activation is
   *       true, a script's too.
   *
   * A redirect of a load the core starts itself (an allowed new window, and on Android an allowed `ask`) is never
   * user-initiated.
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
 * A WebView's navigation state, as the core reports it: from `useWebViewState` and `onNavigationStateChange`.
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
   * Iframes never change it. Always null on Android with an Android System WebView older than 146.
   */
  pendingUrl: string | null;
  title: string;
  /**
   * A main-frame load is in progress.
   *
   * On Android with an Android System WebView older than 146, it goes true only when the load commits (its response
   * arrives), and a load that never commits doesn't change it.
   */
  loading: boolean;
  /** From 0 to 1. */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * How the last main-frame load ended; null while one is loading, and before the first.
   *
   * - `finished`: the page arrived, an HTTP error status (404) included: the site's page shows, and `onError` gets an
   *   `http` error.
   * - `failed`: a network or SSL error, or a renderer crash, cut it off.
   * - `cancelled`: it never showed a page (a stop before the response, a download, a 204, a redirect the rules blocked,
   *   a load a newer one replaced); a stop after the page arrived is `cancelled` on iOS but `finished` on Android, and
   *   a 204 is `finished` on iOS 17.
   *
   * On Android with an Android System WebView older than 146, a load that never commits changes nothing here.
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
   * Why it died: `crash` when the renderer crashed, `memory` when the system killed it to reclaim memory, and `unknown`
   * on iOS, where WebKit doesn't say.
   */
  cause: 'crash' | 'memory' | 'unknown';
  /**
   * Whether the core reloads the page after the crash.
   *
   * - iOS: in place.
   * - Android: in a new WebView, once the view's window is visible. The history is restored unless the `source` page
   *   was on screen. The props are applied again, but not what `call` set.
   *
   * It is false when:
   *
   * - a POST `source` is on screen: as in a browser, it isn't sent again unasked;
   * - more than 3 crashes happened in 60 s (counted for the whole app on Android), until the next
   *   {@link WebViewRef.reload | reload()} (on iOS also a `source` change).
   *
   * While false the view is blank. Leave `reload()` to the user, as a retry button: called from `onProcessGone` it
   * sends the POST again, or starts the crash loop over.
   * @see [Loading and error screens example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#loading-and-error-screens)
   */
  recovered: boolean;
};

/**
 * Runs at document start, before any page script and before the DOM is parsed.
 * @see [Scripts example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#scripts)
 * @group Scripts
 */
export type InjectedScript = {
  /**
   * JavaScript source, run as statements; {@link InjectedScript.origins | origins} decides how its top-level names
   * are scoped.
   */
  code: string;
  /**
   * Runs it in every frame, iframes included.
   * @default `false`
   */
  allFrames?: boolean;
  /**
   * The origins whose frames run it, in the syntax of {@link BridgeOptions.allowedOrigins}.
   *
   * - Each frame is matched by its own `location.origin`, so a listed page's iframes from other origins don't run it.
   *   about:blank and srcdoc frames have their parent's origin.
   * - `'*'` matches every origin, opaque ones (`data:`, sandboxed frames) and `file:` included. `[]` matches none.
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
 * What crosses a bridge, for `createBridge<Schema>`: the methods each side handles, which the other side calls, and the
 * events.
 *
 * With a schema:
 *
 * - `handle` takes only the `reactNative` methods and `call` only the `page` ones. `emit` and `on` take only the
 *   schema's events. Another name doesn't compile.
 * - `params` or a payload is required where its type doesn't allow `undefined`.
 * - A method's `params` and `result` are left out when it has none.
 * - Every key is required: `{}` for a side that handles nothing.
 * - The method and event maps are `type`s or written inline, not `interfaces`: an interface has no index signature, so
 *   it doesn't satisfy `Record`.
 *
 * Params, results and payloads cross as JSON: a `Date` arrives as its ISO string, a `Map` or `Set` as `{}`, `NaN`
 * as `null`, and `undefined` properties and functions are left out. A handler's result that JSON can't encode (a
 * cycle, a `BigInt`) rejects the call with `handler_error`.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export type BridgeSchema = {
  /** The methods React Native answers with `bridge.handle`, and the page calls with `nativeBridge.call`. */
  reactNative: Record<string, { params?: unknown; result?: unknown }>;
  /** The methods the page answers with `nativeBridge.handle`, and React Native calls with `bridge.call`. */
  page: Record<string, { params?: unknown; result?: unknown }>;
  /** The events, by name and payload, that either side emits and the other listens to. */
  events: Record<string, unknown>;
};

type ParamsOf<Method> = 'params' extends keyof Method ? Method['params' & keyof Method] : undefined;
type ResultOf<Method> = 'result' extends keyof Method ? Method['result' & keyof Method] : unknown;
type CallArgs<Method> =
  undefined extends ParamsOf<Method>
    ? [params?: ParamsOf<Method>, options?: { timeoutMs?: number }]
    : [params: ParamsOf<Method>, options?: { timeoutMs?: number }];
type PayloadArg<Payload> = undefined extends Payload ? [payload?: Payload] : [payload: Payload];

/**
 * A promise-based RPC channel to `window.nativeBridge` in the page, typed by a {@link BridgeSchema}.
 *
 * Attach it with the `bridge` prop. Handlers and listeners belong to the bridge, not to a WebView: they stay across
 * unmounts. Messages have no size limit.
 *
 * Each call or event the bridge sends:
 *
 * - waits for the page's `DOMContentLoaded`, so the handlers and listeners of the page's synchronous and deferred
 *   scripts are in place;
 * - never reaches a later page, even one on the same origin;
 * - waits the same way while no WebView is mounted with the bridge. A call's timeout runs meanwhile, and only the
 *   latest 1000 are kept: an older call rejects with `unavailable`.
 *
 * The page's own calls don't wait: one made before React Native has registered its method rejects with `not_found`.
 * Unmounting rejects the calls in flight with `navigated`.
 *
 * The page's `window.nativeBridge` has the same four methods, from its side: {@link PageBridge}.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export type Bridge<Schema extends BridgeSchema = BridgeSchema> = {
  /**
   * Answers `nativeBridge.call(method, params)` from the page, for a method of the schema's `reactNative`.
   *
   * One handler per method: a later one replaces it. Returns an unsubscribe function, which removes only this handler.
   */
  handle<M extends keyof Schema['reactNative'] & string>(
    method: M,
    handler: BridgeHandler<ParamsOf<Schema['reactNative'][M]>, ResultOf<Schema['reactNative'][M]>>
  ): () => void;
  /**
   * Calls a method of the schema's `page`, which the page registered with `nativeBridge.handle`.
   *
   * Rejects with a {@link CodedError}: `timeout`, `not_found`, `handler_error`, `navigated` or `unavailable`.
   * `timeoutMs` overrides the bridge's for this call; a negative or `NaN` one rejects with a plain `RangeError`.
   */
  call<M extends keyof Schema['page'] & string>(
    method: M,
    ...args: CallArgs<Schema['page'][M]>
  ): Promise<ResultOf<Schema['page'][M]>>;
  /**
   * Fires an event the page listens to with `nativeBridge.on`.
   *
   * Dropped if the page goes away before it arrives, or if the page has no listener for it.
   */
  emit<E extends keyof Schema['events'] & string>(
    event: E,
    ...payload: PayloadArg<Schema['events'][E]>
  ): void;
  /**
   * Listens to `nativeBridge.emit(event, payload)` from the page. Returns an unsubscribe function.
   *
   * A listener that throws is reported as an unhandled promise rejection; the event's other listeners still run.
   */
  on<E extends keyof Schema['events'] & string>(
    event: E,
    listener: (payload: Schema['events'][E], sender: BridgeSender) => void
  ): () => void;
  /** What `<WebView>` attaches to. Only `createBridge` sets it, so a hand-made or mock `Bridge` doesn't type-check. */
  readonly [CONNECTION]: BridgeConnection;
};

/**
 * The page's `window.nativeBridge`, for the page's own TypeScript: the same {@link BridgeSchema} as {@link Bridge}, read
 * from the page's side.
 *
 * `handle` takes the schema's `page` methods, and its handler gets the params only (no sender), `call` takes the
 * `reactNative` ones, and `emit` and `on` take the `events`.
 *
 * `window.nativeBridge` exists only in the main frame of a page on one of the bridge's `allowedOrigins`, so a page
 * declares it optional. The page's project needs this package as a dev dependency for the type, which is a type-only
 * import and costs nothing at runtime, and must share or copy the schema type.
 * @see [In the page example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#in-the-page)
 * @group Bridge
 */
export type PageBridge<Schema extends BridgeSchema = BridgeSchema> = {
  /**
   * Answers `bridge.call(method, params)` from React Native, for a method of the schema's `page`.
   *
   * One handler per method: a later one replaces it. Returns an unsubscribe function, which removes only this handler.
   */
  handle<M extends keyof Schema['page'] & string>(
    method: M,
    handler: (
      params: ParamsOf<Schema['page'][M]>
    ) => ResultOf<Schema['page'][M]> | Promise<ResultOf<Schema['page'][M]>>
  ): () => void;
  /**
   * Calls a method of the schema's `reactNative`, which React Native registered with `bridge.handle`.
   *
   * Rejects with a {@link CodedError}: `timeout`, `not_found`, `handler_error`, or `navigated` when the page comes back
   * from the back-forward cache. `timeoutMs` in the options overrides the bridge's for this call; a negative or `NaN`
   * one rejects with a plain `RangeError`.
   */
  call<M extends keyof Schema['reactNative'] & string>(
    method: M,
    ...args: CallArgs<Schema['reactNative'][M]>
  ): Promise<ResultOf<Schema['reactNative'][M]>>;
  /** Fires an event React Native listens to with `bridge.on`. */
  emit<E extends keyof Schema['events'] & string>(
    event: E,
    ...payload: PayloadArg<Schema['events'][E]>
  ): void;
  /** Listens to `bridge.emit(event, payload)` from React Native. Returns an unsubscribe function. */
  on<E extends keyof Schema['events'] & string>(
    event: E,
    listener: (payload: Schema['events'][E]) => void
  ): () => void;
};

/**
 * The options of `createBridge`.
 * @group Bridge
 */
export type BridgeOptions = {
  /**
   * The origins whose pages get `window.nativeBridge`, main frame only.
   *
   * Each is one of:
   *
   * - an origin, `https://example.com`;
   * - a wildcard for subdomains only, not the domain itself, `https://*.example.com`;
   * - an IP literal, `http://[::1]:8080`;
   * - `'*'`, any origin, opaque ones too.
   *
   * Except `'*'`, a rule is http or https, with an optional port, no path and an ASCII (punycode) host. Case is
   * ignored, and a missing port means 80 or 443.
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
  /** Its `accept` list, lowercased and without invalid entries: MIME types and extensions (`.pdf`). */
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
 *
 * Android never grants another resource (MIDI sysex): a request for only those is denied without asking.
 * @group Page requests
 */
export type PermissionResource = 'camera' | 'microphone' | 'geolocation' | 'protectedMedia';
/**
 * A page's permission request, for `onPermissionRequest`.
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
  /**
   * A `file://` in the app's cache (iOS: the temporary directory), which the core never deletes but the OS may: move
   * a file the app keeps.
   */
  uri: string;
  /**
   * A plain file name without a path. The page chose it, like the content and `mimeType`, so don't open the file as
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
 * - `data` (the content): a bad `data:` or `blob:` URL, the page not reading its blob, an unsupported scheme, or
 *   (Android) a file above 100 MB or a `blob:` URL the main frame can't read (a cross-origin iframe's, or one already
 *   revoked).
 * @group Page requests
 */
export type DownloadFailure =
  | {
      /** Tells it from a {@link Download}. */
      ok: false;
      kind: 'network' | 'data';
      /** Empty on iOS when the download failed before its response came. */
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
 * A value for a platform setting. It must fit the property's or setter's type.
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
 * Any public property works, including a newer SDK's (under a root's `other`). Keys the SDK headers list appear in
 * autocomplete, with their `@since`, as do the {@link IOSPrivateSettingKeys}.
 *
 * A value must fit the property's type:
 *
 * - An enum or option set: its raw value, from {@link IOSConstants}.
 * - A struct: an object.
 * - A `UIColor`: `#rrggbb` or `#rrggbbaa`.
 * - An `NSURL`: a string.
 * - `websiteDataStore`: `'default'` or `'nonPersistent'`.
 *
 * A key that doesn't fit, a private (`_`) one, or one the device's iOS lacks (its `@since` is newer) is skipped with a
 * warning; nothing here can crash the app. A property UIKit declares without runtime metadata, such as
 * `webView.opaque`, is skipped the same way: set it with `call('webView.setOpaque:', [false])`.
 *
 * A root's default keys are the package's, and yours go over them. A key the package doesn't set keeps WebKit's
 * default; a key you remove goes back to the value it had before you first set it.
 *
 * WebKit has no mixed-content setting: it applies its own policy.
 * @ios
 * @see [Use a platform API](https://rasmuskard.github.io/react-native-minimal-webview/guides/platform-apis/)
 * @group Platform settings
 */
export type IOSSettings = {
  /**
   * [`WKWebViewConfiguration`](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration): read once,
   * when the WKWebView is created; a change recreates the WebView (the page reloads and the navigation state starts
   * over). It is compared by value, so an inline object with the same keys and values is no change. It is a copy, so
   * `call` on it changes nothing.
   * @default `{ allowsInlineMediaPlayback: true }`
   */
  configuration?: SettingsRoot<
    IOSSettingKeys['configuration'] & IOSPrivateSettingKeys['configuration']
  >;
  /**
   * [`WKPreferences`](https://developer.apple.com/documentation/webkit/wkpreferences) (`configuration.preferences`),
   * live.
   */
  preferences?: SettingsRoot<IOSSettingKeys['preferences'] & IOSPrivateSettingKeys['preferences']>;
  /**
   * [`WKWebpagePreferences`](https://developer.apple.com/documentation/webkit/wkwebpagepreferences)
   * (`configuration.defaultWebpagePreferences`), live from the next navigation.
   */
  webpagePreferences?: SettingsRoot<IOSSettingKeys['webpagePreferences']>;
  /**
   * The [`WKWebView`](https://developer.apple.com/documentation/webkit/wkwebview), live.
   * @default `{ inspectable: __DEV__ }`
   * @see [Debugging the page example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#debugging-the-page)
   */
  webView?: SettingsRoot<IOSSettingKeys['webView']>;
  /**
   * The WKWebView's [`UIScrollView`](https://developer.apple.com/documentation/uikit/uiscrollview), live.
   *
   * `directionalLockEnabled` is on by default.
   */
  scrollView?: SettingsRoot<IOSSettingKeys['scrollView']>;
};

/**
 * Android settings by setter name without `set`.
 *
 * Any public setter works, including a newer SDK's or androidx.webkit's (under a root's `other`). Keys the SDK lists
 * appear in autocomplete, with their `@since`; the constants are in {@link AndroidConstants}. An `int` setter takes a
 * number up to `0xFFFFFFFF`, truncated, so an ARGB color such as `0xFF202020` works.
 *
 * A key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning;
 * nothing here can crash the app. Each key is set on the current WebView as soon as it changes, and again on a new one
 * after a renderer crash.
 *
 * A root's default keys are the package's, and yours go over them. A key the package doesn't set, such as
 * `overScrollMode`, keeps the platform's default.
 *
 * A key you remove goes back to the value it had before you first set it. One with no getter, such as
 * `geolocationEnabled`, keeps its value until the WebView is recreated, with a warning.
 * @android
 * @see [Use a platform API](https://rasmuskard.github.io/react-native-minimal-webview/guides/platform-apis/)
 * @group Platform settings
 */
export type AndroidSettings = {
  /**
   * [`WebSettings`](https://developer.android.com/reference/android/webkit/WebSettings) setters, then static
   * [`WebSettingsCompat`](https://developer.android.com/reference/androidx/webkit/WebSettingsCompat) ones.
   *
   * Each new WebView starts with:
   *
   * - On: `javaScriptEnabled`, `domStorageEnabled`, `supportMultipleWindows`, `builtInZoomControls`,
   *   `useWideViewPort`, `loadWithOverviewMode` and, with Android System WebView 146 and newer,
   *   `backForwardCacheEnabled`.
   * - Off: `allowFileAccess`, `allowContentAccess`, `displayZoomControls` and `downloadFaviconsEnabled`.
   * - `mixedContentMode`: `MIXED_CONTENT_NEVER_ALLOW`.
   *
   * `userAgentString: null` is WebView's default user agent.
   */
  settings?: SettingsRoot<AndroidSettingKeys['settings']>;
  /**
   * [`WebView`](https://developer.android.com/reference/android/webkit/WebView) setters (static and inherited `View`
   * ones too), then [`WebViewCompat`](https://developer.android.com/reference/androidx/webkit/WebViewCompat) ones,
   * then `CookieManager`'s `acceptThirdPartyCookies`.
   *
   * `acceptThirdPartyCookies` is on by default, as react-native-webview has it. `webContentsDebuggingEnabled` is
   * refused: it is process-wide, set with {@link AndroidWebView.setWebContentsDebuggingEnabled}.
   */
  webView?: SettingsRoot<AndroidSettingKeys['webView']>;
};

/**
 * An event a native hook sent with `emit` or `ask`.
 * @typeParam N - The event's name, to type one hook's events.
 * @typeParam P - Its payload.
 * @group Native hooks
 */
export type HookEvent<N extends string = string, P = Record<string, unknown>> = {
  /** The name the hook sent it with, such as `pageLoaded`. */
  name: N;
  /** What the hook sent with it. */
  payload: P;
};

/**
 * A native hook's JS side, for {@link WebViewProps.extensions}: its key, its options, and what takes its events.
 *
 * A package with a native hook exports a function that returns one, so that an app turns the hook on by putting it in
 * `extensions`.
 * @typeParam E - The hook's events, to type `onEvent`: a union of {@link HookEvent}s, which nothing checks at runtime.
 * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 * @group Native hooks
 */
export type HookExtension<E extends HookEvent = HookEvent> = {
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
   * Undefined, the default, means `true`. Turning it on again gives it the new options.
   */
  options?: unknown;
  /**
   * Each of the hook's events: it goes to the extension with the hook's key, and one no extension owns is dropped. For
   * an `ask`, the return value (a promise is awaited) is the answer, and `undefined`, or a value JSON can't encode,
   * answers null. `signal` is set only for an `ask`, and aborts when the core stops waiting for the answer: an ask has
   * no timeout, but one still open when the page goes away is answered null.
   *
   * The latest `onEvent` always takes the events: a render with new handlers sends the core nothing.
   */
  onEvent?(event: E, signal?: AbortSignal): unknown;
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
 * - `not_found`: nothing by that name answers.
 *     - A bridge call: no handler for the method.
 *     - A `hook` call: no attached hook `name` that is on and handles `method`.
 *     - `get` and `call`: a malformed path, or no such root, key, method or selector, including one this OS or WebView
 *       version lacks. On Android a method that takes these arguments doesn't exist; on iOS a private `_` key of `get`
 *       is not found.
 * - `handler_error`: the handler of a bridge call, on either side, or of a `hook` call failed; the `message` is its
 *   error's.
 * - `script_error`: `evaluate`'s script threw, rejected or didn't parse, or, on Android, didn't run because the page
 *   loaded before the core was ready for it.
 * - `native_error`: the platform refused or failed the call.
 *     - A member the core owns, or a private selector for an iOS `call`.
 *     - A key `get` can't read.
 *     - Wrong arguments (iOS).
 *     - A completion handler `call` can't await.
 *     - A native exception or `NSError`.
 *     - A result JSON can't carry (`NaN`).
 * - `navigated`: the page or the WebView went away while the call was pending (a navigation, a crash, an unmount), so
 *   it may have run: retry only what is safe to repeat.
 * - `unavailable`: the call didn't run.
 *     - The WebView is gone or not mounted yet.
 *     - The WebView is being rebuilt after its renderer died (Android).
 *     - The bridge's queue was full and dropped the call.
 *     - The WebView lacks the feature: the method's API reference entry names the Android System WebView it needs, or
 *       a compat method this WebView doesn't support.
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
 * next, and a request without one gets the default described on its prop.
 *
 * One that answers a request and throws (or rejects) is logged with `console.error` and gives the refusing answer:
 *
 * - `onNavigationRequest`: `block`
 * - `onOpenExternal`: null (the core opens nothing)
 * - `onFileRequest`: cancel
 * - `onPermissionRequest`: deny
 * - an extension's `onEvent`: null
 *
 * The `signal` such a callback gets aborts when the core stops waiting for its answer (the page moved on, crashed or
 * unmounted), and a late answer is dropped.
 *
 * JS dialogs (`alert`, `confirm`, `prompt`) and HTTP auth have no prop.
 *
 * - iOS dialogs: a `UIAlertController` titled with the frame's host, or `JavaScript` for a frame without one
 *   (`data:`, sandboxed, `file:`). One shows at a time; one that comes while another shows is cancelled.
 * - Android dialogs: WebView's own.
 * - HTTP auth: cancelled on Android. On iOS WebKit's default handling applies, so without a stored credential the
 *   site's 401 page shows.
 *
 * `dialogs` and `basicAuthCredential` of `@react-native-minimal-webview/extensions` take them over, or a native hook
 * does.
 * @sortStrategy source-order
 * @group WebView
 */
export interface WebViewProps extends Omit<ViewProps, 'children'> {
  /**
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
   * A change applies from the next navigation. On Android with an Android System WebView older than 101 they don't run
   * (a warning says so, once per process).
   * @see [Scripts example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#scripts)
   */
  injectedScripts?: InjectedScript[];
  /**
   * Which navigations load in place, open externally or are blocked, decided natively; the first matching rule wins,
   * and with no match the navigation is blocked.
   *
   * Unset, the rules are {@link defaultNavigationRules}; `[]` is no rules, so every navigation they decide is blocked.
   * A change applies from the next navigation.
   *
   * These skip the rules:
   *
   * - the `source` load, reloads and back/forward; a redirect of the `source` load goes to the rules, and on Android so
   *   does a redirect of a reload or back/forward;
   * - a form POST, on either platform, an iframe's to the main frame (`target=_top`) included: it loads in place; one
   *   to a new window loads in place on iOS and isn't shown on Android (the request may still reach the server);
   * - `about:`, `data:` and `javascript:`, which load in place, except as a new window
   *   ({@link NavigationRule.newWindow}).
   *
   * A `blob:` URL is decided as the origin it carries: `blob:https://example.com/…` as `https://example.com/`, and one
   * with an opaque origin (`blob:null/…`, made by a `data:` or sandboxed frame, or a page from an html `source`
   * without `baseUrl`) is blocked, a download of it too.
   *
   * A malformed rule, one with an unknown key, a field of the wrong type (a list that isn't an array of strings, a flag
   * that isn't a boolean) or no valid `action`, blocks every navigation that reaches it, whatever it was meant to match
   * or do. In development a warning names the rule's index and the problem, once. The rules before it decide as usual;
   * one that isn't an array is `[]`.
   *
   * A native hook can take these decisions, defaults included: see `WebViewContext.clients` (Android) and
   * `navigationDelegates` (iOS).
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
   */
  navigationRules?: readonly NavigationRule[];
  /**
   * Decides each navigation an `ask` rule matches, within 1 s.
   *
   * A late, missing or other answer is `block`, as is one still pending when another page commits; `signal` aborts at
   * the timeout and at that commit. Without this prop, `ask` is `block`. Until the next commit, a URL it allowed isn't
   * asked again on a redirect back to it (Android), or when the same kind of frame loads it again (iOS).
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
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
   * `LSApplicationQueriesSchemes` (iOS) or `<queries>` (Android) entries are needed. An Android `intent:` URL opens
   * only as a browsable intent, without its explicit component or selector; when no app handles it, an http(s)
   * `S.browser_fallback_url` goes through the rules (main frame, no user gesture), and the `intent:` itself is
   * reported as `block`.
   */
  onOpenExternal?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => boolean | void | Promise<boolean | void>;
  /**
   * The bridge to the page, from `createBridge`, of any schema.
   *
   * Read when the WebView is created: another bridge recreates it, so the page reloads and the navigation state starts
   * over. Make the bridge once, at module scope or with `useMemo`. In development, a WebView warns the first time
   * another bridge replaces its own.
   *
   * A bridge serves one mounted WebView at a time: attaching it to a second throws.
   *
   * On Android with an Android System WebView older than 101 there is no bridge: calls reject with `unavailable`, and a
   * warning says so, once per process.
   */
  bridge?: Pick<Bridge, typeof CONNECTION>;
  /**
   * The native hooks to turn on, as {@link HookExtension}s.
   *
   * A false, null or undefined entry is left out, so `on && extension(…)` switches one on and off; see
   * {@link HookExtension.options} for what off means. A hook attaches when its key first appears, and a later change of
   * its `options` reaches it live, without recreating the WebView. A key turned on after the WebView was created
   * attaches its hook then, unless the hook has a `configure` step or its own WebView class (`webViewClass`,
   * `webViewFactory`): that one attaches only to a WebView mounted with its key on, and a warning says so.
   * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
   */
  extensions?: readonly (HookExtension | false | null | undefined)[];
  /**
   * Pull down at the top of the page to reload: `UIRefreshControl` on iOS, `SwipeRefreshLayout` on Android, where a
   * pull inside a scrolled inner scroller (`overflow: auto` or `scroll`) scrolls it instead.
   *
   * It reloads as {@link WebViewRef.reload | reload()} does, a POST `source` included, but leaves the
   * {@link ProcessGoneEvent.recovered | crash recovery} limit in place. A change applies at once.
   * @default `false`
   */
  pullToRefresh?: boolean;
  /**
   * Syncs cookies between `HTTPCookieStorage`, which holds the cookies of native requests, and the WebView:
   *
   * - `HTTPCookieStorage` into the WebView before each `source` load, which waits for it;
   * - the WebView into `HTTPCookieStorage` on every cookie change, deletions included, as it happens.
   *
   * Android needs nothing: `CookieManager` is shared app-wide, and flushed when the app goes to the background. A
   * WebView on another `android.webView.profile` has that profile's cookies instead.
   * @default `false`
   * @ios
   * @see [Cookies example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#cookies)
   */
  sharedCookies?: boolean;
  /**
   * Answers `<input type="file">` with `file://` or `content://` URIs, or null to cancel.
   *
   * Until the answer settles, the page's next file request waits.
   *
   * Without it, the system file chooser opens and ignores `capture`. It handles one request at a time for the whole
   * app: a request while one is open is cancelled. If the chooser's activity died without returning a result, every
   * request is cancelled until the app restarts.
   *
   * iOS always shows WebKit's picker, whose camera option needs `NSCameraUsageDescription`.
   * @android
   * @see [File inputs example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#file-inputs)
   */
  onFileRequest?: (
    request: FileRequest,
    signal: AbortSignal
  ) => string[] | null | Promise<string[] | null>;
  /**
   * The page entered or left fullscreen (`active`).
   *
   * Fullscreen works without it: the page's view covers the window, the system bars hide and back exits. iOS shows
   * WebKit's own fullscreen, not reported; there an element other than a video goes fullscreen only with
   * `ios.preferences.elementFullscreenEnabled`.
   * @android
   * @see [Fullscreen video example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#fullscreen-video)
   */
  onFullscreenChange?: (event: FullscreenChangeEvent) => void;
  /**
   * Answers a page's camera, microphone and, on Android, location and protected media (DRM) requests.
   *
   * Only the main frame asks (on Android, which doesn't name the frame, any frame of the top page's origin); other
   * frames, and a page with an opaque origin (`data:`, a sandboxed frame), are denied without asking, with or without
   * this prop.
   *
   * Answer true to grant; anything else denies. Ask the OS first (expo-camera, expo-location): without OS permission
   * the page's request fails anyway. On iOS, true also skips WebKit's own prompt. Android keeps a location answer
   * until the page changes.
   *
   * Without this prop, Android denies and iOS shows WebKit's prompt. iOS needs `NSCameraUsageDescription` and
   * `NSMicrophoneUsageDescription` (`NSLocationWhenInUseUsageDescription` for location), Android the `CAMERA` and
   * `RECORD_AUDIO` manifest permissions (`ACCESS_COARSE_LOCATION` or `ACCESS_FINE_LOCATION` for location).
   *
   * `signal` also aborts when Android withdraws the request. Until the answer settles, the page's next request of the
   * same kind waits.
   * @see [Permissions example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#permissions)
   */
  onPermissionRequest?: (
    request: PermissionRequest,
    signal: AbortSignal
  ) => boolean | Promise<boolean>;
  /**
   * A download finished ({@link Download}) or failed ({@link DownloadFailure}).
   *
   * With this prop the core saves the file. iOS downloads it in the page's session. Android fetches it again with the
   * host's cookies (whatever their SameSite) and the page's user agent, without the POST body, `source` headers or
   * HTTP auth, so a download that needs them can fail, or save the server's login page as the file. The fetch also
   * fails on a redirect off https, and for `blob:` on an Android System WebView older than 83.
   *
   * Without this prop, an http(s) download opens externally (`onOpenExternal` or the system browser, without the page's
   * session), and a `data:` or `blob:` one is dropped. A PDF is a download on Android; iOS shows it inline.
   *
   * On iOS a file response is a download only in the main frame; an `<a download>` link is one from any frame.
   *
   * On Android a native hook's `WebViewContext.onDownloadStart` is offered each download first, and one it takes
   * reaches neither this prop nor the external fallback.
   * @see [Downloads example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#downloads)
   */
  onDownload?: (result: DownloadResult) => void;
  /**
   * Every navigation the rules, or their defaults, decided.
   *
   * Not reported: the `source` load, reloads, back/forward, a form POST, and a navigation a native hook decides.
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
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
   * with an Android System WebView older than 146, an SSL error on a back/forward load isn't reported.
   *
   * A renderer crash isn't reported here: it makes the cut-off load's `outcome` `failed` and calls `onProcessGone`.
   * @see [Loading and error screens example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#loading-and-error-screens)
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
   * On Android with an Android System WebView older than 146, that is when the page commits (its response arrives),
   * not when the load starts, and a load that never commits fires neither this nor `onLoadEnd`.
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
 * A handle kept after its WebView unmounted is safe to call. `evaluate`, `get`, `call` and `hook` are the methods that
 * return a promise:
 *
 * - After an unmount: the navigation methods do nothing and the four promise methods reject with `unavailable`.
 * - Pending when the WebView unmounts: the four reject with `navigated`.
 * - Just mounted: the four wait up to about a second for the view (on Android, a call from the parent's first effect
 *   can come before the view exists), then reject with `unavailable`. In the background they don't wait.
 * @sortStrategy source-order
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
   * Reloads the page; after a failed load, retries it (the `source` again, with its headers, when that failed), and
   * loads the `source` when nothing is loaded.
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
   * its ISO string. The value is the page's, so treat it as page data.
   *
   * Rejects with a {@link CodedError}: `script_error`, `navigated` or `unavailable`. There is no timeout: a page can
   * hold a call until it navigates. On Android with an Android System WebView older than 83 it rejects with
   * `unavailable`.
   * @see [Scripts example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#scripts)
   */
  evaluate(script: string): Promise<unknown>;
  /**
   * Reads a platform setting, `root.key`, and resolves with its value through JSON, as {@link WebViewRef.call | call}
   * converts results.
   *
   * The roots are those of {@link IOSSettings} and {@link AndroidSettings}, plus on iOS `websiteDataStore` and
   * `httpCookieStore`, and on Android `cookieManager` and `webStorage` (the WebView profile's: `webView.profile`, the
   * default one unless set). A key is the property's name on iOS, and on Android the getter's name without `get` or
   * `is`.
   *
   * It reads the WebView as it is when the call arrives: a navigation doesn't reject it. Rejects with a
   * {@link CodedError}: `not_found`, `unavailable` or `native_error`.
   * @see [Reading and calling example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#reading-and-calling)
   */
  get(key: string): Promise<unknown>;
  /**
   * Calls a platform method, `root.method`, and resolves with its result through JSON. It acts on the WebView as it is
   * when the call arrives: a navigation doesn't reject it.
   *
   * The roots are those of {@link WebViewRef.get | get}. On Android `method` is a public method of the root's object;
   * on iOS an Objective-C selector.
   *
   * Rejects with a {@link CodedError}: `not_found`, `unavailable` or `native_error`.
   *
   * The core owns, and so rejects:
   *
   * - iOS: every selector that loads, navigates (`setInteractionState:` too), runs a script, starts a download or sets
   *   a delegate, and private (`_`), KVC, `willChange…`, `didChange…`, `performSelector`, `init…`, `copy…`,
   *   `mutable…`, `new…` and reference-counting selectors.
   * - Android: the loads, navigations, clients, JavaScript interfaces, web message listeners, document-start scripts,
   *   the download, touch, scroll-change and navigation listeners, `destroy`, `removeAllViews`, `pauseTimers`,
   *   `resumeTimers`, `evaluateJavascript` and remote debugging
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
   * `Name`, `Value` and `Path` are required, and `Domain` unless `OriginURL` is given; `Max-Age` (seconds, as a string), `Secure`, `HttpOnly` and
   * `SameSite` are some of the optional ones. A tag that can't make its object (`{ data }` that isn't base64, a
   * `{ cookie }` without a required key) rejects with `native_error`.
   * @returns The result: primitives, strings, and collections of them; on iOS also the structs as objects, an `NSURL`
   * as a string, an `NSDate` as seconds, `NSData` as base64, a `UIImage` as a base64 PNG and an `NSHTTPCookie` as its
   * properties (`Expires` in seconds). Any other object is `null`.
   * @see [Call a method](https://rasmuskard.github.io/react-native-minimal-webview/guides/platform-apis/#4-call-a-method)
   * @see [Reading and calling example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#reading-and-calling)
   */
  call(method: string, args?: unknown[]): Promise<unknown>;
  /**
   * Calls the `method` handler the native hook `name` registered with `context.handle`, with `args`, and resolves with
   * its reply; both cross as JSON.
   *
   * The reply converts as {@link WebViewRef.call | call}'s results do. Rejects with a {@link CodedError}:
   * `not_found`, `unavailable`, `handler_error` when the handler fails the call (`reply.fail(message)`, or a throw on
   * Android), or `native_error` for a non-finite number in the reply. A navigation or a crash doesn't settle a call
   * whose handler hasn't replied; only an unmount does.
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
