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
 * @see [Bundled page folder example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#load-a-bundled-page-folder)
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
       * Sent with each load of the `source`: the first, a reload (`reload()` or pull-to-refresh), and a crash recovery
       * that loads the `source` again. The page's later navigations don't send them.
       *
       * On Android, WebView may replace a header it sets itself, such as one for caching or accepted types, with its
       * own value. It replaces `User-Agent`, so set that with {@link WebViewProps.userAgent | userAgent}.
       */
      headers?: Record<string, string>;
      /**
       * Makes the request a POST with this form-urlencoded body.
       *
       * Its `Content-Type` is `application/x-www-form-urlencoded`. On iOS, `headers` can set another. Android sends no
       * `headers` with a POST.
       */
      body?: string;
      /**
       * For a `file://` `uri`, the directory the page may read, as a `file://` URL that contains the file.
       *
       * Without it, the page reads the file's directory. A value that isn't a `file:` URL or doesn't contain the file
       * gets the file's directory too, with a warning.
       * @ios
       */
      readAccessRoot?: string;
    }
  | {
      html: string;
      /** The page's URL. Its relative URLs resolve against it, and it has this origin. Without it, `about:blank`. */
      baseUrl?: string;
    };

/**
 * What happens to a navigation.
 *
 * - `allow`: it loads in place. On iOS a tapped universal link loads in place too, instead of opening its app.
 * - `block`: it is cancelled.
 * - `external`: `onOpenExternal` opens it, or else the system does.
 * @group Navigation
 */
export type NavigationAction = 'allow' | 'block' | 'external';

/**
 * A pattern over a navigation's URL and kind, and what the navigations it matches do.
 *
 * A navigation matches when every field the rule sets matches. A list matches when one of its entries does. A field
 * left out matches anything, and a flag set to `false` matches only the navigations without it.
 * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
 * @group Navigation
 */
export type NavigationRule = {
  /** URL schemes without the `:` (`tel`), exact and case-insensitive. */
  scheme?: string[];
  /**
   * Hosts: exact, or a `*.` wildcard that matches subdomains only, not the domain itself.
   *
   * Case, port, userinfo and a trailing dot are ignored. An internationalized domain matches only in its ASCII form,
   * `xn--mnchen-3ya.de`, not `münchen.de`.
   */
  host?: string[];
  /**
   * Prefixes of the percent-encoded URL path, compared as strings, not by segment.
   *
   * A URL without an authority (`myapp:/open`) has the path `/`.
   */
  path?: string[];
  /**
   * Query parameters, percent-encoded as in the URL and case-sensitive. A name matches that parameter with any value,
   * and `name=value` matches only that exact value.
   */
  query?: string[];
  /**
   * The main frame's navigation (true) or an iframe's (false).
   *
   * On Android only an iframe's non-http(s) navigations reach the rules, a `blob:` one as the http(s) origin it
   * carries. So there a `mainFrame: false` rule for http(s) decides only an iframe's `blob:` navigations, and an `ask`
   * blocks them.
   */
  mainFrame?: boolean;
  /**
   * A `target=_blank` or `window.open` navigation, always a main-frame one.
   *
   * An allowed one loads in place. There is never a second WebView, so the page gets no `window.opener`. For real
   * popups, a native hook takes `createWebViewWith` (iOS) or `onCreateWindow` (Android).
   *
   * - One to `data:`, `blob:`, `javascript:`, `file:` or an `about:` URL other than `about:blank` is always blocked.
   *   On Android a `javascript:` one's script may still run, with the page's origin.
   * - One opened with no URL (`window.open('')`) or to `about:blank` is decided by the URL the page sends it to within
   *   5 s, and dropped otherwise.
   * - One opened without a user gesture reaches the rules only with `javaScriptCanOpenWindowsAutomatically` on, in
   *   `ios.preferences` and `android.settings`. It is off by default, and the platform then drops the window without
   *   a report.
   */
  newWindow?: boolean;
  /**
   * A user gesture started it: the user's tap, click or key press.
   *
   * - Android: true for any navigation the page starts within a few seconds of a tap that doesn't scroll, a click or
   *   a key press, a script's too: a `location.href` change, a `window.open`, a timer's navigation.
   * - iOS: true only for a link activation (`<a>`, `<area>`, `target=_blank` too) within 1 s of a tap on the WebView
   *   that scrolls and zooms nothing, a link a script clicks in that second included. A `location.href` change or
   *   `window.open`, even from a click handler, a form submission and a link activated from a hardware keyboard are
   *   false. VoiceOver and Switch Control activate links without a touch, so while either runs every link activation
   *   is true, a script's too.
   */
  userInitiated?: boolean;
  /**
   * What the navigations it matches do. `ask` puts each to `onNavigationRequest`.
   *
   * On Android, `ask` works only in the main frame and is `block` elsewhere. The navigation is cancelled, and an
   * allowed one loads again after the answer, without the page's referrer policy or the gesture flag.
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
   * Index of the matching rule in `navigationRules`, or in {@link defaultNavigationRules} when that is unset.
   *
   * Null when no rule decided: none matched, the scheme always loads in place or is always blocked, or a download
   * opened externally.
   */
  rule: number | null;
};

/**
 * A WebView's navigation state, from `useWebViewState` and `onNavigationStateChange`.
 *
 * While no WebView is mounted it is the initial state: `url` and `title` empty, `pendingUrl` and `outcome` null,
 * `loading`, `canGoBack` and `canGoForward` false, `progress` 0.
 * @group Navigation
 */
export type NavigationState = {
  /**
   * The page on screen. It changes when a load commits and on a same-document navigation (`pushState`,
   * `replaceState`, a hash change), and keeps the old page while a load is in progress.
   *
   * After a failed load, the failed URL. Iframes never change it.
   */
  url: string;
  /**
   * The URL of a main-frame load in progress, which may still fail or be blocked.
   *
   * Iframes never change it. Always null on Android with an Android System WebView older than 146.
   */
  pendingUrl: string | null;
  title: string;
  /**
   * A main-frame load is in progress.
   *
   * On Android with an Android System WebView older than 146, it turns true only when the load commits, and a load
   * that never commits doesn't change it.
   */
  loading: boolean;
  /** From 0 to 1. */
  progress: number;
  /**
   * Whether there is a page to go back to.
   *
   * On Android, as for Chrome's back button, it leaves out the entry of a page that added another without a user
   * gesture (a `pushState`, a hash change, or a navigation to another document that a script or timer started), unless
   * a tap led to that page. So it is false when every earlier entry is left out, whatever `history.length` says. With
   * an Android System WebView older than 102, an iframe's history entry doesn't update it.
   */
  canGoBack: boolean;
  /** Whether there is a page to go forward to. An iframe's history entry updates it as it does `canGoBack`. */
  canGoForward: boolean;
  /**
   * How the last main-frame load ended. Null while one is loading, and before the first.
   *
   * - `finished`: the page arrived, also with an HTTP error status such as 404. The site's page shows, and `onError`
   *   gets an `http` error.
   * - `failed`: a network or SSL error, or a renderer crash, cut it off.
   * - `cancelled`: it never showed a page, as after a stop before the response, a download or a redirect the rules
   *   blocked. A stop after the page arrived is `cancelled` on iOS and `finished` on Android.
   *
   * On Android with an Android System WebView older than 146, a load that never commits doesn't change it.
   */
  outcome: 'finished' | 'failed' | 'cancelled' | null;
};

/**
 * A main-frame error, for `onError`.
 *
 * - `network` and `ssl`: the load failed, on iOS also after it committed. An SSL error always cancels the load. `code`
 *   is the platform's own: the `NSError` code on iOS, and on Android a `WebViewClient.ERROR_*` for `network` and an
 *   `SslError.SSL_*` for `ssl`. `description` is the error's localized description on iOS. On Android it is
 *   Chromium's error name for `network` (`net::ERR_NAME_NOT_RESOLVED`), or a sentence when no WebView can be made,
 *   and `SSL error` with the code for `ssl`.
 * - `http`: the response had an HTTP error status (400 or above), and the site's own error page shows.
 *
 * A load the app or the page stops or replaces reports no error. Nor does a cancellation: `NSURLErrorCancelled`
 * (-999) or WebKit error 102 on iOS, `net::ERR_ABORTED` on Android.
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
   * Why it died: `crash` when the renderer crashed, `memory` when the system killed it to reclaim memory. Always
   * `unknown` on iOS.
   */
  cause: 'crash' | 'memory' | 'unknown';
  /**
   * Whether the core reloads the page after the crash. The reload waits until the view is in a visible window and the
   * app is not in the background. A `load()`, `reload()` or new `source` in the meantime loads instead.
   *
   * - iOS reloads in place.
   * - Android reloads in a new WebView. It restores the history, unless the `source` page was on screen and reloads.
   *   It applies the props again, but not what `call` set.
   *
   * It is false when:
   *
   * - a POST `source` is on screen, which, as in a browser, isn't sent again unasked;
   * - more than 3 crashes happened in 60 s, counted for the whole app on Android. It stays false until the next
   *   {@link WebViewRef.reload | reload()} or {@link WebViewRef.load | load()}, or on iOS a `source` change.
   *
   * While it is false the view is blank. Leave `reload()` and `load()` to the user, behind a retry button. Called from
   * `onProcessGone`, `reload()` sends the POST again, and either one starts the crash loop over.
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
   * JavaScript source, run as statements. {@link InjectedScript.origins | origins} decides how its top-level names
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
   * - `'*'` matches every origin, opaque ones (`data:`, sandboxed frames) and `file:` included. `[]` matches none.
   *
   * Without `'*'` in the list, the code runs inside a function. Its top-level `let`, `const`, `class`, `function` and
   * `var` stay local to it, so put what the page should see on `window`. An invalid rule throws when the WebView
   * renders.
   */
  origins: string[];
};

/**
 * Who sent a call or event: the page's origin as `location.origin` writes it (`https://example.com:8443`). Native
 * code checks it, and the page doesn't supply it.
 *
 * Every allowed origin gets the same trust, so a handler that serves only some origins checks this.
 * @group Bridge
 */
export type BridgeSender = { origin: string };

/**
 * Answers a bridge call. Its return value, or what its promise resolves to, is the result.
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
 *
 * Params, results and payloads cross as JSON. A handler's result that JSON can't encode, such as a cycle or a
 * `BigInt`, rejects the call with `handler_error`.
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

/**
 * The constraint on a schema type `S`: a {@link BridgeSchema} keyed by `S`'s own names, so an `interface` satisfies it.
 * @group Bridge
 */
export type SchemaOf<S> = {
  [Side in keyof BridgeSchema]: {
    [K in keyof S[Side & keyof S]]: BridgeSchema[Side][string];
  };
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
 * Attach it with the `bridge` prop. Handlers and listeners belong to the bridge, not to a WebView, so they stay across
 * unmounts. Messages have no size limit.
 *
 * Each call or event the bridge sends:
 *
 * - waits for the page's `DOMContentLoaded`, so the handlers and listeners of the page's synchronous and deferred
 *   scripts are in place;
 * - never reaches a later page, even one on the same origin;
 * - waits the same way while no WebView is mounted with the bridge. A call's timeout runs meanwhile, and only the
 *   latest 1000 are kept, so an older call rejects with `unavailable`.
 *
 * The page's own calls don't wait: one made before React Native has registered its method rejects with `not_found`.
 * Unmounting rejects the calls the page received with `navigated`, and the queued ones with `unavailable`.
 *
 * The page's `window.nativeBridge` has the same four methods, from its side: {@link PageBridge}.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export type Bridge<Schema extends SchemaOf<Schema> = BridgeSchema> = {
  /**
   * Answers `nativeBridge.call(method, params)` from the page, for a method of the schema's `reactNative`.
   *
   * A method has one handler, and a later one replaces it. Returns an unsubscribe function, which removes only this
   * handler.
   */
  handle<M extends keyof Schema['reactNative'] & string>(
    method: M,
    handler: BridgeHandler<ParamsOf<Schema['reactNative'][M]>, ResultOf<Schema['reactNative'][M]>>
  ): () => void;
  /**
   * Calls a method of the schema's `page`, which the page registered with `nativeBridge.handle`.
   *
   * Rejects with a {@link CodedError}: `timeout`, `not_found`, `handler_error`, `navigated` or `unavailable`.
   * `timeoutMs` overrides the bridge's for this call. A negative or `NaN` one rejects with a plain `RangeError`.
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
   * A listener that throws is reported as an unhandled promise rejection, and the event's other listeners still run.
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
 * `handle` takes the schema's `page` methods, and its handler gets only the params, without a sender. `call` takes the
 * `reactNative` methods, and `emit` and `on` take the `events`.
 *
 * `window.nativeBridge` exists only in the main frame of a page on one of the bridge's `allowedOrigins`, so a page
 * declares it optional. For the type, the page's project needs this package as a dev dependency, and the schema type,
 * shared or copied.
 * @see [In the page example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#in-the-page)
 * @group Bridge
 */
export type PageBridge<Schema extends SchemaOf<Schema> = BridgeSchema> = {
  /**
   * Answers `bridge.call(method, params)` from React Native, for a method of the schema's `page`.
   *
   * A method has one handler, and a later one replaces it. Returns an unsubscribe function, which removes only this
   * handler.
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
   * from the back-forward cache. `timeoutMs` in the options overrides the bridge's for this call. A negative or `NaN`
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
   * The origins whose pages get `window.nativeBridge`, in the main frame only.
   *
   * Each is one of:
   *
   * - an origin, `https://example.com`;
   * - a wildcard for subdomains only, not the domain itself, `https://*.example.com`;
   * - an IP literal, `http://[::1]:8080`;
   * - `'*'`, any origin, opaque ones too.
   *
   * A rule other than `'*'` is http or https, with an optional port, no path and an ASCII (punycode) host. Case is
   * ignored, and a missing port means 80 or 443.
   */
  allowedOrigins: string[];
  /**
   * Per-call timeout in milliseconds, and the default for the page's `nativeBridge.call` too. `0` or `Infinity` means
   * no timeout.
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
  /** Its `accept` list of MIME types and extensions (`.pdf`), lowercased and without invalid entries. */
  accept: string[];
  multiple: boolean;
  /** Whether it has a `capture` attribute, which asks for the camera. */
  capture: boolean;
};

/**
 * A device resource a page can ask for.
 *
 * `geolocation` and `protectedMedia` (DRM playback) are Android only. On iOS, WebKit always shows its own location
 * prompt.
 *
 * Android denies a request for only other resources, such as MIDI sysex, without asking.
 * @group Page requests
 */
export type PermissionResource = 'camera' | 'microphone' | 'geolocation' | 'protectedMedia';
/**
 * A page's permission request, for `onPermissionRequest`.
 * @group Page requests
 */
export type PermissionRequest = {
  /** The requesting page's origin, as `location.origin` writes it. Every `file:` page is `file://`. */
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
   * A `file://` URL in the app's cache directory, on iOS its temporary directory. The core never deletes it, but the
   * OS may, so move a file the app keeps.
   */
  uri: string;
  /**
   * A plain file name without a path. The page chose it, as it chose the content and `mimeType`, so don't treat the
   * file as trusted. On Android a `data:` or `blob:` link's name is guessed, not taken from its `download` attribute.
   */
  filename: string;
  mimeType: string;
  /** The server URL the file came from, or `null` when the page generated it (a `data:` or `blob:` URL). */
  url: string | null;
};

/**
 * A download that could not be saved. `kind` says why:
 *
 * - `network`: connecting or reading the response failed, or a redirect was refused.
 * - `http`: the response had an error status. Android only, as iOS saves what the server sent.
 * - `data`: a bad `data:` or `blob:` URL, the page failing to read its blob, or an unsupported scheme. On Android also
 *   a file above 100 MiB, or a `blob:` URL the main frame can't read, such as a cross-origin iframe's or a revoked
 *   one.
 * @group Page requests
 */
export type DownloadFailure =
  | {
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
 * A settings root. Its keys are generated from the SDK headers ({@link IOSSettingKeys}, {@link AndroidSettingKeys}),
 * so a misspelled key fails to compile. `other` takes the keys they lack.
 * @group Platform settings
 */
export type SettingsRoot<Keys> = Keys & {
  /**
   * Any other key the platform has, such as a newer SDK's, untyped. It is set as if it were at the root. A generated
   * key can't go here.
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
 * Any public property works, a newer SDK's too under a root's `other`. Keys the SDK headers list appear in
 * autocomplete with their `@since`, as do the {@link IOSPrivateSettingKeys}.
 *
 * A value must fit the property's type:
 *
 * - An enum or option set: its raw value, from {@link IOSConstants}.
 * - A struct: an object.
 * - A `UIColor`: `#rrggbb` or `#rrggbbaa`.
 * - An `NSURL`: a string.
 * - `websiteDataStore`: `'default'` or `'nonPersistent'`.
 *
 * A key that doesn't fit, a private (`_`) one, or one the device's iOS lacks is skipped with a warning, so nothing here
 * can crash the app. A property UIKit declares without runtime metadata, such as `webView.opaque`, is skipped the same
 * way. Set it with `call('webView.setOpaque:', [false])`.
 *
 * A root's default keys are the package's, and yours go over them. A key the package doesn't set keeps WebKit's
 * default. A key you remove goes back to the value it had before you first set it. To put
 * `webView.underPageBackgroundColor` back to WebKit's default, set it to `null` instead of removing it.
 * @ios
 * @see [Use a platform API](https://rasmuskard.github.io/react-native-minimal-webview/guides/platform-apis/)
 * @group Platform settings
 */
export type IOSSettings = {
  /**
   * [`WKWebViewConfiguration`](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration), read once
   * when the WKWebView is created. A change recreates the WebView: the page reloads and the navigation state starts
   * over. It is compared by value, so an inline object with the same keys and values is no change. A `call` on it
   * changes nothing, because the WebView keeps its own copy.
   * @default `{ allowsInlineMediaPlayback: true }`
   */
  configuration?: SettingsRoot<
    IOSSettingKeys['configuration'] & IOSPrivateSettingKeys['configuration']
  >;
  /**
   * [`WKPreferences`](https://developer.apple.com/documentation/webkit/wkpreferences) (`configuration.preferences`),
   * applied at once.
   */
  preferences?: SettingsRoot<IOSSettingKeys['preferences'] & IOSPrivateSettingKeys['preferences']>;
  /**
   * [`WKWebpagePreferences`](https://developer.apple.com/documentation/webkit/wkwebpagepreferences)
   * (`configuration.defaultWebpagePreferences`), applied from the next navigation.
   */
  webpagePreferences?: SettingsRoot<IOSSettingKeys['webpagePreferences']>;
  /**
   * The [`WKWebView`](https://developer.apple.com/documentation/webkit/wkwebview), applied at once.
   * @default `{ inspectable: __DEV__ }`
   * @see [Debugging the page example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#debugging-the-page)
   */
  webView?: SettingsRoot<IOSSettingKeys['webView']>;
  /**
   * The WKWebView's [`UIScrollView`](https://developer.apple.com/documentation/uikit/uiscrollview), applied at once.
   *
   * `directionalLockEnabled` is on by default.
   */
  scrollView?: SettingsRoot<IOSSettingKeys['scrollView']>;
};

/**
 * Android settings by setter name without `set`.
 *
 * Any public setter works, a newer SDK's or androidx.webkit's too under a root's `other`. Keys the SDK lists appear in
 * autocomplete with their `@since`, and the constants are in {@link AndroidConstants}. An `int` setter takes a number
 * up to `0xFFFFFFFF`, truncated, so an ARGB color such as `0xFF202020` works.
 *
 * A key with no public setter for the value's type, or one this device's WebView lacks, is skipped with a warning, so
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
   *   `useWideViewPort`, `loadWithOverviewMode`, and `backForwardCacheEnabled` with Android System WebView 146 and
   *   newer. An older WebView refuses `backForwardCacheEnabled: true`, in this prop and in `call`.
   * - Off: `allowFileAccess`, `allowContentAccess`, `displayZoomControls` and `downloadFaviconsEnabled`.
   * - `mixedContentMode`: `MIXED_CONTENT_NEVER_ALLOW`.
   *
   * `userAgentString: null` is WebView's default user agent.
   */
  settings?: SettingsRoot<AndroidSettingKeys['settings']>;
  /**
   * [`WebView`](https://developer.android.com/reference/android/webkit/WebView) setters, static and inherited `View`
   * ones too, then [`WebViewCompat`](https://developer.android.com/reference/androidx/webkit/WebViewCompat) ones, then
   * `CookieManager`'s `acceptThirdPartyCookies`.
   *
   * `acceptThirdPartyCookies` is on by default. `webContentsDebuggingEnabled` is refused because it is process-wide.
   * Set it with {@link AndroidWebView.setWebContentsDebuggingEnabled}.
   */
  webView?: SettingsRoot<AndroidSettingKeys['webView']>;
};

/**
 * An event a native hook sent with `emit` or `ask`.
 * @typeParam N - The event's name, to type one hook's events.
 * @group Native hooks
 */
export type HookEvent<N extends string = string, P = Record<string, unknown>> = {
  /** The name the hook sent it with, such as `pageLoaded`. */
  name: N;
  payload: P;
};

/**
 * A native hook's JS side, for {@link WebViewProps.extensions}: its key, its options, and the handlers of its events.
 *
 * A package with a native hook exports a function that returns one, and an app turns the hook on by putting it in
 * `extensions`.
 * @typeParam E - The hook's events, to type `onEvent` and `onAsk`: a union of {@link HookEvent}s, which nothing checks
 * at runtime.
 * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 * @group Native hooks
 */
export type HookExtension<E extends HookEvent = HookEvent> = {
  /**
   * The key the hook is registered under.
   *
   * A key no hook is registered under warns, so pass a one-platform hook's extension on that platform only. Two
   * extensions with one key warn in development, and the later one wins.
   */
  key: string;
  /**
   * What the hook gets as its options. `undefined`, the default, means `true`.
   *
   * Null or false switches the hook off, as does leaving its extension out of `extensions`. An off hook stays attached
   * and gets null, but the core routes none of its delegates, clients or listeners, drops its events, answers its asks
   * with null, and rejects `ref.hook` calls to its handlers with `not_found`. Turning it on again gives it the new
   * options.
   */
  options?: unknown;
  /**
   * Gets each of the hook's events. An event goes to the extension with the hook's key, and one that no extension owns
   * is dropped.
   *
   * An `ask` goes to {@link HookExtension.onAsk} when the extension has one. Otherwise it comes here with `signal` set,
   * and the return value is the answer, as `onAsk` describes. `signal` is undefined for an `emit`.
   *
   * The latest `onEvent` and `onAsk` always get the events.
   */
  onEvent?(event: E, signal?: AbortSignal): unknown;
  /**
   * Gets each of the hook's asks, in place of {@link HookExtension.onEvent}. The return value, or what its promise
   * resolves to, is the answer. `undefined`, or a value JSON can't encode, answers null.
   *
   * An ask has no timeout. `signal` aborts when the core stops waiting for the answer, and an ask still open when the
   * page goes away is answered null.
   */
  onAsk?(event: E, signal: AbortSignal): unknown;
};

/**
 * A fullscreen change, for `onFullscreenChange`.
 * @android
 * @group Events
 */
export type FullscreenChangeEvent = { active: boolean };

/**
 * Why a ref method or a bridge call rejected. A code means the same on every method that rejects with it.
 *
 * - `timeout`: a bridge call got no answer in time.
 * - `not_found`: nothing by that name answers.
 *     - A bridge call: no handler for the method.
 *     - A `hook` call: no attached hook `name` that is on and handles `method`.
 *     - `get` and `call`: a malformed path, or no such root, key, method or selector, including one this OS or WebView
 *       version lacks. On Android also a method that exists, but not for these arguments. On iOS also a private (`_`)
 *       key for `get`.
 * - `handler_error`: the handler of a bridge call, on either side, or of a `hook` call failed. The `message` is its
 *   error's.
 * - `script_error`: `evaluate`'s script threw, rejected or didn't parse. On Android also a script that didn't run
 *   because the page loaded before the core was ready for it.
 * - `native_error`: the platform refused or failed the call.
 *     - A member the core owns, or a private selector for an iOS `call`.
 *     - A key `get` can't read.
 *     - Wrong arguments (iOS).
 *     - A completion handler `call` can't await.
 *     - A native exception or `NSError`.
 *     - A result JSON can't carry (`NaN`).
 * - `navigated`: the page or the WebView went away while the call was pending, through a navigation, a crash or an
 *   unmount. The call may have run, so retry only what is safe to repeat.
 * - `unavailable`: the call didn't run.
 *     - The WebView is gone or not mounted yet.
 *     - The WebView is being rebuilt after its renderer died (Android).
 *     - The bridge's queue was full and dropped the call.
 *     - The WebView lacks the feature: the method's API reference entry names the Android System WebView version it
 *       needs, or it is a compat method this WebView doesn't support.
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
 * The props of `<WebView>`. Only `source` is required.
 *
 * React Native's `ViewProps` go to the native view.
 *
 * Each `on…` callback is read when its event or request comes, so adding, changing or removing one applies to the
 * next. A request without its callback gets the default its prop describes. A request whose callback throws or rejects
 * is logged with `console.error` and gets the refusing answer:
 *
 * - `onNavigationRequest`: `block`
 * - `onOpenExternal`: null, so the core opens nothing
 * - `onFileRequest`: cancel
 * - `onPermissionRequest`: deny
 * - an extension's `onAsk` or `onEvent`: null
 *
 * The `signal` such a callback gets aborts when the core stops waiting for its answer, because the page moved on,
 * crashed or unmounted. A late answer is dropped.
 *
 * JS dialogs (`alert`, `confirm`, `prompt`) and HTTP auth have no prop. The `dialogs` and `basicAuthCredential`
 * extensions of `@react-native-minimal-webview/extensions` take them over, or a native hook does. Without one:
 *
 * - iOS shows a dialog as a `UIAlertController` titled with the frame's host, or `JavaScript` for a frame without a
 *   host. It shows one at a time, and cancels a dialog that comes while another shows.
 * - Android shows WebView's own dialogs. One still on screen when its WebView unmounts stays there, and a WebView
 *   older than 149 then gets no touches until the app restarts. The `dialogs` extension shows no native dialog.
 * - Android cancels HTTP auth. On iOS, WebKit's default handling sends a stored credential, and once the site has
 *   rejected one, the site's 401 page shows.
 * @sortStrategy source-order
 * @group WebView
 */
export interface WebViewProps extends Omit<ViewProps, 'children'> {
  /**
   * A new `source` loads at once, unless it equals the loaded one field by field. An equal one loads nothing, even
   * after the page navigated away.
   */
  source: WebViewSource;
  /**
   * WebKit settings by property name. See {@link IOSSettings}.
   * @ios
   */
  ios?: IOSSettings;
  /**
   * Android settings by setter name. See {@link AndroidSettings}.
   * @android
   */
  android?: AndroidSettings;
  /**
   * Replaces the whole user agent, and wins over `ios.webView.customUserAgent` and `android.settings.userAgentString`.
   * Without it those keys apply, and without them the platform's own user agent.
   *
   * To append to the default user agent instead, set `ios.configuration.applicationNameForUserAgent` and, on Android,
   * `android.settings.userAgentString` to `AndroidWebView.defaultUserAgent` plus your suffix. A change to
   * {@link IOSSettings.configuration | ios.configuration} recreates the WebView. For a suffix that changes, read
   * `navigator.userAgent` once with {@link WebViewRef.evaluate | evaluate()} and set `userAgent` to it plus the suffix.
   *
   * A change applies from the next navigation.
   */
  userAgent?: string;
  /**
   * Scripts to run at document start, before the page's own, in the frames each script's `allFrames` and `origins`
   * pick.
   *
   * A change applies from the next navigation. On Android with an Android System WebView older than 101 they don't run,
   * and a warning says so once per process.
   * @see [Scripts example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#scripts)
   */
  injectedScripts?: InjectedScript[];
  /**
   * Which navigations load in place, open externally or are blocked, decided natively. The first matching rule wins,
   * and a navigation no rule matches is blocked.
   *
   * Unset, the rules are {@link defaultNavigationRules}. `[]` is no rules, so every navigation they decide is blocked.
   * A change applies from the next navigation.
   *
   * These skip the rules:
   *
   * - The `source` load, {@link WebViewRef.load | load}, reloads and back/forward. Their redirects go to the rules,
   *   except a redirect of a reload or back/forward on iOS.
   * - A form POST, an iframe's to the main frame (`target=_top`) included. It loads in place. One to a new window
   *   loads in place on iOS, and on Android isn't shown, though the request may still reach the server.
   * - `about:`, `data:` and `javascript:`, which load in place, except as a new window
   *   ({@link NavigationRule.newWindow}).
   *
   * A `blob:` URL is decided as the origin it carries: `blob:https://example.com/…` as `https://example.com/`. One
   * with an opaque origin (`blob:null/…`) is blocked, a download of it too. A `data:` or sandboxed frame makes such a
   * URL, as does a page from an html `source` without `baseUrl`.
   *
   * A malformed rule blocks every navigation that reaches it, whatever it was meant to match or do. A rule is
   * malformed when it has an unknown key, a field of the wrong type (a list that isn't an array of strings, a flag that
   * isn't a boolean) or no valid `action`. In development a warning names the rule's index and the problem, once. The
   * rules before it decide as usual. A `navigationRules` that isn't an array is `[]`.
   *
   * A native hook can take these decisions, defaults included: see `WebViewContext.clients` (Android) and
   * `navigationDelegates` (iOS).
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
   */
  navigationRules?: readonly NavigationRule[];
  /**
   * Decides each navigation an `ask` rule matches, within 1 s.
   *
   * A late, missing or other answer is `block`, as is one still pending when another page commits. `signal` aborts at
   * the timeout and at that commit. Without this prop, `ask` is `block`.
   *
   * Until the next page commits, a URL it allowed isn't asked again on a redirect back to it (Android), or when the same
   * kind of frame loads it again (iOS).
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
   */
  onNavigationRequest?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => NavigationAction | Promise<NavigationAction>;
  /**
   * Opens each `external` navigation, an Android `intent:` URL included, before `onNavigation` reports it.
   *
   * Return false, or a promise of false, to hand it back. The core then opens it as it does without this prop, an
   * `intent:`'s fallback URL included. Any other answer, `undefined` too, means you opened it. When `signal` aborts,
   * nothing opens it.
   *
   * Without this prop, the system browser or the app for the URL opens it. The core doesn't ask `canOpenURL` first, so
   * no `LSApplicationQueriesSchemes` (iOS) or `<queries>` (Android) entries are needed. An Android `intent:` URL opens
   * only as a browsable intent, without its explicit component or selector. When no app handles it, an http(s)
   * `S.browser_fallback_url` goes through the rules as a main-frame navigation without a user gesture, and the
   * `intent:` itself is reported as `block`.
   */
  onOpenExternal?: (
    request: NavigationRequest,
    signal: AbortSignal
  ) => boolean | void | Promise<boolean | void>;
  /**
   * The bridge to the page, from `createBridge`, of any schema.
   *
   * It is read when the WebView is created, so another bridge recreates the WebView: the page reloads and the
   * navigation state starts over. Make the bridge once, at module scope or with `useMemo`. In development, a WebView
   * warns the first time another bridge replaces its own.
   *
   * A bridge serves one mounted WebView at a time, and attaching it to a second throws.
   *
   * On Android with an Android System WebView older than 101 there is no bridge. Calls reject with `unavailable`, and
   * a warning says so once per process.
   */
  bridge?: Pick<Bridge, typeof CONNECTION>;
  /**
   * The native hooks to turn on, as {@link HookExtension}s.
   *
   * A false, null or undefined entry is left out, so `on && extension(…)` switches one on and off. See
   * {@link HookExtension.options} for what off means. A hook attaches when its key first appears, and a later change
   * of its `options` reaches it live, without recreating the WebView.
   *
   * A key turned on after the WebView was created attaches its hook then. A hook that attaches only to a WebView
   * mounted with its key on warns instead. The
   * [guide's Lifecycle table](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/#lifecycle)
   * says which hooks do.
   * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
   */
  extensions?: readonly (HookExtension | false | null | undefined)[];
  /**
   * Pull down at the top of the page to reload. On Android, a pull inside a scrolled inner scroller (`overflow: auto`
   * or `scroll`) scrolls it instead.
   *
   * It reloads as {@link WebViewRef.reload | reload()} does, but leaves the
   * {@link ProcessGoneEvent.recovered | crash recovery} limit in place. A change applies at once.
   * @default `false`
   */
  pullToRefresh?: boolean;
  /**
   * Syncs cookies between `HTTPCookieStorage`, which holds the cookies of native requests, and the WebView:
   *
   * - `HTTPCookieStorage` into the WebView before each `source` load and {@link WebViewRef.load | load}, which wait
   *   for it;
   * - the WebView into `HTTPCookieStorage` on every cookie change, deletions included, as it happens.
   *
   * Android needs no sync. Its WebViews and React Native's `fetch` share one `CookieManager` app-wide, and the core
   * flushes it when the app goes to the background. A WebView on another `android.webView.profile` has that profile's
   * cookies instead.
   * @default `false`
   * @ios
   * @see [Cookies example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#cookies)
   */
  sharedCookies?: boolean;
  /**
   * Answers `<input type="file">` with `file://` or `content://` URIs, or null to cancel.
   *
   * The page's next file request waits until the answer settles.
   *
   * Without this prop, the system file chooser opens, and it ignores `capture`. It handles one request at a time for
   * the whole app, and cancels a request that comes while one is open.
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
   * Fullscreen works without this prop: the page's view covers the window, the system bars hide, and back exits. iOS
   * shows WebKit's own fullscreen and doesn't report it. There, an element other than a video goes fullscreen only
   * with `ios.preferences.elementFullscreenEnabled`.
   * @android
   * @see [Fullscreen video example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#fullscreen-video)
   */
  onFullscreenChange?: (event: FullscreenChangeEvent) => void;
  /**
   * Answers a page's camera and microphone requests, and on Android its location and protected media (DRM) requests.
   *
   * Only the main frame asks, or on Android any frame of the top page's origin. Other frames, and a page with an
   * opaque origin (`data:`, a sandboxed frame), are denied without asking, with or without this prop.
   *
   * Answer true to grant. Anything else denies. Ask the OS first: without the OS permission the page's request fails
   * anyway. On iOS, true also skips WebKit's own prompt. Android keeps a location answer until the page changes.
   *
   * Without this prop, Android denies and iOS shows WebKit's prompt. iOS needs `NSCameraUsageDescription` and
   * `NSMicrophoneUsageDescription`, and `NSLocationWhenInUseUsageDescription` for location. Android needs the `CAMERA`
   * and `RECORD_AUDIO` manifest permissions, and `ACCESS_COARSE_LOCATION` or `ACCESS_FINE_LOCATION` for location.
   *
   * `signal` also aborts when Android withdraws the request. The page's next request of the same kind waits until the
   * answer settles.
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
   * host's cookies, whatever their SameSite, and the page's user agent, but without the POST body, `source` headers or
   * HTTP auth. A download that needs them can fail, or save the server's login page as the file. The fetch also fails
   * on a redirect off https, and for `blob:` on an Android System WebView older than 83.
   *
   * Without this prop, an http(s) download opens externally (`onOpenExternal` or the system browser) without the
   * page's session, and a `data:` or `blob:` one is dropped. A PDF is a download on Android, and iOS shows it inline.
   *
   * On iOS a file response is a download only in the main frame, and an `<a download>` link is one from any frame.
   *
   * On Android a native hook's `WebViewContext.onDownloadStart` is offered each download first, and one it takes
   * reaches neither this prop nor the external fallback.
   * @see [Downloads example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#downloads)
   */
  onDownload?: (result: DownloadResult) => void;
  /**
   * Each navigation the rules decided, the default rules included.
   *
   * Not reported: the `source` load, {@link WebViewRef.load | load}, reloads, back/forward, a form POST, and a
   * navigation a native hook decides.
   * @see [Navigation rules example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-rules)
   */
  onNavigation?: (event: NavigationEvent) => void;
  /**
   * Every change to the navigation state.
   *
   * Changes that arrive together may be combined into one call. `loading` going true is never combined away, so a load
   * that starts and fails at once still reports both.
   */
  onNavigationStateChange?: (state: NavigationState) => void;
  /**
   * A main-frame load failed, or got an HTTP error status.
   *
   * After a failed load iOS keeps the previous page on screen, and Android shows WebView's own error page. On Android
   * with an Android System WebView older than 146, an SSL error on a back/forward load isn't reported.
   *
   * A renderer crash isn't reported here. It makes the cut-off load's `outcome` `failed` and calls `onProcessGone`.
   *
   * On Android it also gets a `network` error with code `-1` when no WebView can be made because Android System
   * WebView is missing, disabled or updating. {@link WebViewRef.reload | reload()} tries again.
   * @see [Loading and error screens example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#loading-and-error-screens)
   */
  onError?: (event: LoadErrorEvent) => void;
  /**
   * The renderer died. See {@link ProcessGoneEvent} for the recovery.
   *
   * Android's WebViews share one renderer, so each of them reports its death. On Android it comes before the
   * {@link WebViewProps.onLoadEnd | onLoadEnd} that fails the load the crash cut off.
   */
  onProcessGone?: (event: ProcessGoneEvent) => void;
  /** {@link NavigationState.loading | loading} went true. */
  onLoadStart?: (state: NavigationState) => void;
  /** `loading` went false. `state.outcome` says how the load ended. */
  onLoadEnd?: (state: NavigationState) => void;
  /**
   * Gets the {@link WebViewRef}.
   *
   * Give each mounted WebView its own ref. A ref shared by two points at the last one mounted, with a warning in
   * development, and can turn null when either unmounts.
   */
  ref?: Ref<WebViewRef>;
}

/**
 * The methods a WebView's `ref` gets: navigation, scripts, and platform and hook calls.
 *
 * A handle kept after its WebView unmounted is safe to call. `evaluate`, `get`, `call` and `hook` return promises:
 *
 * - After an unmount, the navigation methods do nothing and the four promise methods reject with `unavailable`.
 * - When the WebView unmounts while they are pending, the four reject with `navigated`, and a waiting `load` does
 *   nothing.
 * - Just after mount, the four and `load` wait up to about a second for the view, then the four reject with
 *   `unavailable` and `load` does nothing. In the background they don't wait.
 * @sortStrategy source-order
 * @group WebView
 */
export type WebViewRef = {
  /**
   * Goes back one page. Does nothing unless `canGoBack`.
   *
   * On Android it also skips the entries that {@link NavigationState.canGoBack | canGoBack} leaves out.
   */
  goBack(): void;
  /** Goes forward one page. Does nothing unless `canGoForward`. */
  goForward(): void;
  /**
   * Loads `url` in place, as a navigation the app started, in a new history entry. The page on screen loads again in
   * its own entry. `source` stays as it is, so a re-render with the same `source` still loads nothing. Combined with a
   * `source` change, which of the two ends on screen depends on the platform and on timing, so do one or the other.
   *
   * It starts the {@link ProcessGoneEvent.recovered | crash recovery} limit over. A `javascript:` URL loads nothing,
   * with a warning in development. Run a script with {@link WebViewRef.evaluate | evaluate} instead. Another URL goes
   * to the platform, and one it can't load, such as an unknown scheme, ends with `outcome` `failed`. On iOS a string
   * that isn't a URL loads nothing, with a warning.
   *
   * A `file://` URL:
   *
   * - iOS: reads only within its directory.
   * - Android: needs `android.settings.allowFileAccess`, which lets a `file:` page read any file the app can.
   */
  load(url: string): void;
  /**
   * Reloads the page. After a failed load it retries that load, the `source` with its headers when the `source`
   * failed. When nothing is loaded, it loads the `source`.
   *
   * It sends a POST `source` again, and lifts the limit on {@link ProcessGoneEvent.recovered | crash recovery}.
   */
  reload(): void;
  /** Stops the load. Its {@link NavigationState.outcome | outcome} says how the load ended. */
  stopLoading(): void;
  /**
   * Runs an expression, not statements, in the page's main frame and awaits it.
   *
   * Resolves with its value through JSON, and with `null` for a value JSON can't encode, such as a function, `NaN` or a
   * cycle. The value comes from the page, so treat it as page data.
   *
   * Rejects with a {@link CodedError}: `script_error`, `navigated` or `unavailable`. There is no timeout, so a page can
   * hold a call until it navigates. On Android with an Android System WebView older than 83 it rejects with
   * `unavailable`.
   * @see [Scripts example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#scripts)
   */
  evaluate(script: string): Promise<unknown>;
  /**
   * Reads a platform setting, `root.key`, and resolves with its value through JSON, converted as
   * {@link WebViewRef.call | call} converts results.
   *
   * The roots are those of {@link IOSSettings} and {@link AndroidSettings}, plus `websiteDataStore` and
   * `httpCookieStore` on iOS, and `cookieManager` and `webStorage` on Android. The Android ones are the WebView
   * profile's: `webView.profile`, or the default profile when that is unset. A key is the property's name on iOS, and
   * on Android the getter's name without `get` or `is`.
   *
   * It reads the WebView as it is when the call arrives, so a navigation doesn't reject it. Rejects with a
   * {@link CodedError}: `not_found`, `unavailable` or `native_error`.
   * @see [Reading and calling example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#reading-and-calling)
   */
  get(key: string): Promise<unknown>;
  /**
   * Calls a platform method, `root.method`, with `args`, and resolves with its result through JSON.
   *
   * The roots are those of {@link WebViewRef.get | get}. On iOS `method` is an Objective-C selector, and on Android a
   * public method of the root's object. Leave a trailing completion handler (iOS) or `ValueCallback` (Android) out of
   * `args`. The call then resolves with what it reports, or on iOS rejects with its error.
   *
   * It acts on the WebView as it is when the call arrives, so a navigation doesn't reject it. Rejects with a
   * {@link CodedError}: `not_found`, `unavailable` or `native_error`.
   *
   * The core owns these, and rejects a call to them:
   *
   * - iOS: every selector that loads, navigates (`setInteractionState:` too), runs a script, starts a download or sets
   *   a delegate, and private (`_`), KVC, `willChange…`, `didChange…`, `performSelector`, `init…`, `copy…`,
   *   `mutable…`, `new…` and reference-counting selectors.
   * - Android: the loads, navigations, clients, JavaScript interfaces, web message listeners, document-start scripts,
   *   the download, touch, scroll-change and navigation listeners, `destroy`, `removeAllViews`, `pauseTimers`,
   *   `resumeTimers`, `evaluateJavascript` and remote debugging
   *   ({@link AndroidWebView.setWebContentsDebuggingEnabled}).
   *
   * On iOS, a selector whose completion handler isn't in this package's SDK headers, or reports something other than
   * an object, an error or an integer, rejects with `native_error`. On Android, a method that takes `args` as they are
   * wins over one that also takes a callback, and a `null` in the callback's place passes none.
   *
   * Two mistakes the signature can't catch crash the app: on iOS an object argument of the wrong class, and on Android
   * a `null` listener or callback other than the trailing `ValueCallback`, once WebView calls it. For a method that
   * takes another object, write a native hook.
   *
   * @param args The method's arguments: booleans, numbers, strings and `null`. On iOS also the structs as objects, and
   * `{ set: [...] }`, `{ date: seconds }`, `{ data: base64 }` or `{ cookie: properties }` for an `NSSet`, `NSDate`,
   * `NSData` or `NSHTTPCookie`. Any other string stays an `NSString`. A cookie's properties are `NSHTTPCookie`'s keys,
   * with `Max-Age` in seconds as a string. A tag that can't make its object, such as `{ data }` that isn't base64 or
   * `{ cookie }` properties that make no cookie, rejects with `native_error`.
   * @returns The result: primitives, strings, and collections of them. On iOS also the structs as objects, an `NSURL`
   * as a string, an `NSDate` as seconds, `NSData` as base64, a `UIImage` as a base64 PNG and an `NSHTTPCookie` as its
   * properties (`Expires` in seconds). Any other object is `null`.
   * @see [Call a method](https://rasmuskard.github.io/react-native-minimal-webview/guides/platform-apis/#4-call-a-method)
   * @see [Reading and calling example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#reading-and-calling)
   */
  call(method: string, args?: unknown[]): Promise<unknown>;
  /**
   * Calls the `method` handler that the native hook `name` registered with `context.handle`, with `args`, and resolves
   * with its reply. Both cross as JSON, and the reply converts as {@link WebViewRef.call | call}'s results do.
   *
   * Rejects with a {@link CodedError}: `not_found`, `unavailable`, `handler_error` when the handler fails the call
   * (`reply.fail(message)`, or a throw on Android), or `native_error` for a non-finite number in the reply. A
   * navigation or a crash doesn't settle a call whose handler hasn't replied. Only an unmount does.
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
   * Calls `listener` on every state change, a WebView mounting or unmounting included, and returns the unsubscribe
   * function.
   *
   * A subscriber stays across remounts.
   */
  subscribe(listener: () => void): () => void;
};
