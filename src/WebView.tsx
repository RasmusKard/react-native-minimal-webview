import { requireNativeModule, requireNativeView } from 'expo';
import {
  type ReactElement,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { type BridgeConnection, CONNECTION } from './bridge/createBridge';
import { WK } from './platform.generated';
import type {
  AndroidWebViewInfo,
  Bridge,
  NativeEvent as HookEventBody,
  NavigationEvent,
  NavigationState,
  ProcessGoneEvent,
  SettingValue,
  WebViewErrorEvent,
  WebViewProps,
  WebViewRef,
  WebViewRefObject,
} from './types';

type NativeEvent<T> = { nativeEvent: T };

/** Native reports every main-frame error as one event; `code` is the HTTP status for `http`. */
type NativeErrorEvent = Omit<WebViewErrorEvent, 'kind'> & {
  kind: WebViewErrorEvent['kind'] | 'http';
};

type BridgeEvent = { message?: string; unavailable?: boolean; navigated?: boolean };

/** `askId` is set when native waits for the answer (`WebViewContext.ask`). */
type HookEvent = HookEventBody & { askId?: number };

/**
 * Page requests the core answers natively, by native event name (`core.` plus the key). Native asks JS only for those
 * whose prop is set, and reads the set when the request comes, so a prop can come and go. `openExternal` is never
 * asked: native only checks that JS opens external links itself, and reports them on `onNavigation`.
 */
const REQUESTS = {
  navigationRequest: 'onNavigationRequest',
  openExternal: 'onOpenExternal',
  fileRequest: 'onFileRequest',
  fullscreenChange: 'onFullscreenChange',
  permissionRequest: 'onPermissionRequest',
  download: 'onDownload',
  httpAuthRequest: 'onHttpAuthRequest',
} as const;
/** The core's own events; everything else is a hook's, for `onNativeEvent`. */
const CORE = 'core.';

/** Every prop that is not a `ViewProps` one, so it never reaches the outermost view. */
const OWN = [
  'source',
  'ios',
  'android',
  'userAgent',
  'applicationNameForUserAgent',
  'mediaPlaybackRequiresUserAction',
  'javaScriptCanOpenWindowsAutomatically',
  'webviewDebuggingEnabled',
  'navigationRules',
  'injectedScripts',
  'bridge',
  'pullToRefresh',
  'sharedCookies',
  'nativeOptions',
  'onNativeEvent',
  'renderLoading',
  'renderError',
  'onNavigation',
  'onNavigationStateChange',
  'onError',
  'onHttpError',
  'onProcessGone',
  'onLoadStart',
  'onLoad',
  'onLoadEnd',
  ...Object.values(REQUESTS),
  'children',
] as const satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[];
type Unlisted = Exclude<Exclude<keyof WebViewProps, keyof ViewProps>, (typeof OWN)[number]>;
// A prop missing from OWN fails to compile here, by name.
const OWN_SET: Set<string> &
  ([Unlisted] extends [never] ? unknown : Record<Unlisted, 'missing from OWN'>) = new Set(OWN);

/** `WKAudiovisualMediaTypeAudio | Video`; WebKit's `.all` is NSUIntegerMax, which JSON can't carry exactly. */
const MEDIA_ALL = WK.AudiovisualMediaTypes.all;

type NativeSettings = Record<string, Record<string, SettingValue | undefined>>;

type NativeProps = ViewProps &
  Pick<WebViewProps, 'source' | 'navigationRules' | 'injectedScripts' | 'pullToRefresh'> & {
    ref: Ref<NativeMethods>;
    /** iOS only: Android's CookieManager is already shared. */
    sharedCookies: boolean | undefined;
    /**
     * The platform's settings by root and name, as JSON: `ios` or `android` with the cross-platform props on top. A
     * string, so that a `null` (reset this key) survives the trip; the native dictionary conversion drops it.
     */
    settings: string;
    bridgeScript: string | undefined;
    bridgeOrigins: string[] | undefined;
    nativeOptions: Record<string, unknown> | undefined;
    requestHandlers: string[];
    onNavigation: (event: NativeEvent<NavigationEvent>) => void;
    onNavigationState: (event: NativeEvent<NavigationState>) => void;
    onBridge: (event: NativeEvent<BridgeEvent>) => void;
    onNativeEvent: (event: NativeEvent<HookEvent>) => void;
    onError: (event: NativeEvent<NativeErrorEvent>) => void;
    onProcessGone: (event: NativeEvent<ProcessGoneEvent>) => void;
  };

type NativeMethods = {
  navigate(action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  bridgePost(message: string): Promise<void>;
  /** Answers a native `ask`. The value is wrapped: native arguments can't be of any type. */
  answer(askId: number, answer: { value: unknown }): Promise<void>;
  /** The JSON-encoded result, or null. */
  evaluate(script: string): Promise<string | null>;
  getUrl(): Promise<string | null>;
  /** `{ get }` reads a setting, `{ call, args, completion }` calls a platform method: the JSON of the result. */
  native(request: {
    get?: string;
    call?: string;
    args?: unknown[];
    completion?: string;
  }): Promise<string>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');
const nativeModule = () =>
  requireNativeModule<{ androidWebViewInfo: AndroidWebViewInfo; defaultUserAgent: string }>(
    'MinimalWebView'
  );

const INITIAL_STATE: NavigationState = {
  url: '',
  pendingUrl: null,
  title: '',
  loading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
};

type Attachment = { update(state: NavigationState): void; detach(): void };
type Adapter = {
  nav: WebViewRefObject;
  attach(handle: WebViewRef, state: NavigationState): Attachment;
};

/** The navigation object behind each ref object: created by createWebViewRef, or made on first use for a plain ref. */
const adapters = new WeakMap<object, Adapter>();

function adapterFor(ref: object) {
  let adapter = adapters.get(ref);
  if (!adapter) adapters.set(ref, (adapter = createAdapter()));
  return adapter;
}

function createAdapter(): Adapter {
  let attached: WebViewRef | null = null;
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const set = (next: NavigationState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const nav: WebViewRefObject = {
    get current() {
      return attached;
    },
    goBack: () => attached?.goBack(),
    goForward: () => attached?.goForward(),
    reload: () => attached?.reload(),
    stopLoading: () => attached?.stopLoading(),
    evaluate: async (script) => await attached?.evaluate(script),
    getUrl: async () => (await attached?.getUrl()) ?? '',
    get: async (key) => await attached?.get(key),
    call: async (method, args, options) => await attached?.call(method, args, options),
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    nav,
    // Last attached wins, like a React ref; an earlier instance's later updates and detach are ignored.
    attach(handle, initial) {
      if (__DEV__ && attached) {
        console.warn(
          '[minimal-rn-webview] This ref is already attached to a mounted WebView; the new one replaces it. Give each WebView its own ref.'
        );
      }
      attached = handle;
      set(initial);
      return {
        update: (next) => attached === handle && set(next),
        detach() {
          if (attached !== handle) return;
          attached = null;
          set(INITIAL_STATE);
        },
      };
    },
  };
}

/**
 * A ref to pass as a WebView's `ref`, made outside React (a module, a store) so code outside React can use it. It
 * forwards the methods to whichever WebView is mounted with it (no-ops while none is), and keeps its subscribers across
 * remounts.
 */
export function createWebViewRef(): WebViewRefObject {
  const adapter = createAdapter();
  adapters.set(adapter.nav, adapter);
  return adapter.nav;
}

/** Runs a JS handler that native waits on: one that throws still answers, with the safe default. */
const settle = <T,>(handler: () => T | Promise<T>, fallback: T, failure: string) =>
  Promise.resolve()
    .then(handler)
    .catch((error: unknown) => {
      console.error(`[minimal-rn-webview] ${failure}`, error);
      return fallback;
    });

const NEEDS = {
  bridge: {
    features: ['WEB_MESSAGE_LISTENER', 'DOCUMENT_START_SCRIPT'],
    lost: 'bridge calls reject with `unavailable`',
  },
  injectedScripts: {
    features: ['DOCUMENT_START_SCRIPT'],
    lost: "`when: 'start'` scripts don't run",
  },
  endScripts: {
    features: ['JS_INJECTION_IN_FRAME_AND_WORLD'],
    lost: "`when: 'end'` scripts don't run (WebView 146+)",
  },
};
// Read once, failures included.
let info: AndroidWebViewInfo | null | undefined;
const warned = new Set<string>();

/** Android: warns once per process for each used prop whose WebView features the device lacks. */
export function warnUnsupported(used: Record<keyof typeof NEEDS, boolean>) {
  if (Platform.OS !== 'android') return;
  for (const [prop, { features, lost }] of Object.entries(NEEDS)) {
    if (!used[prop as keyof typeof NEEDS] || warned.has(prop)) continue;
    if (info === undefined) {
      try {
        info = WebView.androidWebViewInfo;
      } catch {
        info = null; // native module or React context missing: stay quiet
      }
    }
    const device = info;
    const missing = features.filter((feature) => device && !device.features[feature]);
    if (!device || !missing.length) continue;
    warned.add(prop);
    console.warn(
      `[minimal-rn-webview] ${prop} needs WebView features ${missing.join(', ')}, missing in ${device.provider} ${device.version}: ${lost}. Update Android System WebView.`
    );
  }
}

export function WebView({ ref, ...props }: WebViewProps & { ref?: Ref<WebViewRef> }) {
  const native = useRef<NativeMethods>(null);
  const attachmentRef = useRef<Attachment>(undefined);
  const { error, loading, onNavigationState, onError, lastRef } = useLoadEvents(
    props,
    attachmentRef
  );

  // Methods called before the native view exists are no-ops, like a browser tab that is still opening.
  const [handle] = useState((): WebViewRef => {
    const parsed = (json: string | null | undefined) =>
      json ? (JSON.parse(json) as unknown) : undefined;
    return {
      goBack: () => void native.current?.navigate('back'),
      goForward: () => void native.current?.navigate('forward'),
      reload: () => void native.current?.navigate('reload'),
      stopLoading: () => void native.current?.navigate('stop'),
      evaluate: async (script) => parsed(await native.current?.evaluate(script)),
      getUrl: async () => (await native.current?.getUrl()) ?? '',
      get: async (key) => parsed(await native.current?.native({ get: key })),
      call: async (method, args = [], options) =>
        parsed(
          await native.current?.native({ call: method, args, completion: options?.completion })
        ),
    };
  });
  useAttach(ref, handle, lastRef, attachmentRef);

  const fixed = useFixedAtMount(props);
  // The same string while nothing in it changed, so a re-render sends native nothing.
  const settings = JSON.stringify(platformSettings({ ...props, ...fixed.creation }));
  const connection =
    fixed.bridge && (fixed.bridge as Bridge & { [CONNECTION]: BridgeConnection })[CONNECTION];
  useEffect(() => {
    if (!connection) return undefined;
    connection.attach((message) => void native.current?.bridgePost(message));
    return () => connection.detach();
  }, [connection]);

  const hasStart = !!props.injectedScripts?.some((script) => script.when !== 'end');
  const hasEnd = !!props.injectedScripts?.some((script) => script.when === 'end');
  useEffect(
    () => warnUnsupported({ bridge: !!connection, injectedScripts: hasStart, endScripts: hasEnd }),
    [connection, hasStart, hasEnd]
  );

  const onBridge = ({ nativeEvent }: NativeEvent<BridgeEvent>) => {
    if (nativeEvent.message !== undefined) connection?.receive(nativeEvent.message);
    else if (nativeEvent.navigated) connection?.navigated();
    else connection?.markUnavailable();
  };

  const answer = (askId: number, value: unknown) =>
    native.current?.answer(askId, { value: value ?? null });

  const requestHandlers = useRequestHandlers(props);

  const onNativeEvent = async ({
    nativeEvent: { name, payload, askId },
  }: NativeEvent<HookEvent>) => {
    if (name === `${CORE}settingsRejected`) return warnRejected(payload);
    const request = name.startsWith(CORE)
      ? REQUESTS[name.slice(CORE.length) as keyof typeof REQUESTS]
      : undefined;
    const handler = request
      ? (props[request] as ((payload: unknown) => unknown) | undefined)
      : () => props.onNativeEvent?.({ name, payload });
    const value = await settle(
      () => handler?.(payload),
      // Native counts a missing answer as `block` too.
      request === 'onNavigationRequest' ? 'block' : null,
      request ? `${request} failed` : `onNativeEvent failed for ${name}`
    );
    if (askId !== undefined) await answer(askId, value);
  };

  const onNavigation = ({ nativeEvent }: NativeEvent<NavigationEvent>) => {
    if (nativeEvent.action === 'external') props.onOpenExternal?.(nativeEvent.url);
    props.onNavigation?.(nativeEvent);
  };

  const webView = (
    <NativeWebView
      {...(props.renderLoading || props.renderError ? {} : viewPropsOf(props))}
      ref={native}
      source={props.source}
      style={props.renderLoading || props.renderError ? styles.fill : props.style}
      settings={settings}
      pullToRefresh={props.pullToRefresh ?? false}
      sharedCookies={Platform.OS === 'ios' ? (props.sharedCookies ?? false) : undefined}
      navigationRules={props.navigationRules}
      injectedScripts={props.injectedScripts}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      nativeOptions={fixed.nativeOptions}
      requestHandlers={requestHandlers}
      onNavigation={onNavigation}
      onNavigationState={onNavigationState}
      onBridge={onBridge}
      onNativeEvent={onNativeEvent}
      onError={onError}
      onProcessGone={({ nativeEvent }) => props.onProcessGone?.(nativeEvent)}
    />
  );
  return withOverlay(webView, props, error, loading);
}

/**
 * Puts `handle` in a callback or plain ref. Any ref object also gets the navigation state through its adapter, which a
 * createWebViewRef one is, so it forwards the methods too.
 */
function useAttach(
  ref: Ref<WebViewRef> | undefined,
  handle: WebViewRef,
  lastRef: RefObject<NavigationState>,
  attachmentRef: RefObject<Attachment | undefined>
) {
  const adapter = ref && typeof ref === 'object' ? adapterFor(ref) : undefined;
  useImperativeHandle(adapter?.nav === ref ? undefined : ref, () => handle, [handle]);
  useLayoutEffect(() => {
    if (!adapter) return undefined;
    const attached = adapter.attach(handle, lastRef.current);
    attachmentRef.current = attached;
    return () => {
      attached.detach();
      attachmentRef.current = undefined;
    };
  }, [adapter, handle, lastRef, attachmentRef]);
}

/** The page requests with a prop set, as a new array only when that set changes. */
function useRequestHandlers(props: WebViewProps) {
  const key = Object.entries(REQUESTS)
    .filter(([, prop]) => props[prop])
    .map(([event]) => event)
    .join();
  return useMemo(() => (key ? key.split(',') : []), [key]);
}

/** The cross-platform props that are creation-time settings on iOS: fixed at mount on both platforms, for one behaviour. */
const CREATION = ['applicationNameForUserAgent', 'mediaPlaybackRequiresUserAction'] as const;
const creationProps = (props: WebViewProps) =>
  Object.fromEntries(CREATION.map((key) => [key, props[key]])) as Pick<
    WebViewProps,
    (typeof CREATION)[number]
  >;

/**
 * Native sets up the bridge, the hooks (with their options) and the creation settings once, at mount; the JS handlers
 * (`bridge.handle`, `onNativeEvent`) stay live. A later change is ignored with a warning: remount with a new `key` to
 * apply it. (A changed `ios.configuration` key is reported by native, through `settingsRejected`.)
 */
function useFixedAtMount(props: WebViewProps) {
  const [fixed] = useState(() => ({
    bridge: props.bridge,
    nativeOptions: props.nativeOptions,
    creation: creationProps(props),
  }));
  const warned = useRef(false);
  const changed =
    props.bridge !== fixed.bridge ||
    JSON.stringify(props.nativeOptions) !== JSON.stringify(fixed.nativeOptions) ||
    JSON.stringify(creationProps(props)) !== JSON.stringify(fixed.creation);
  useEffect(() => {
    if (!changed || warned.current) return;
    warned.current = true;
    console.warn(
      '[minimal-rn-webview] `bridge`, `nativeOptions`, `applicationNameForUserAgent` and `mediaPlaybackRequiresUserAction` are fixed at mount; this change is ignored. Remount the WebView with a new `key` to apply it.'
    );
  }, [changed]);
  return fixed;
}

/** `style`, `testID`, the accessibility props and the other ViewProps, for the outermost view. */
function viewPropsOf(props: WebViewProps): ViewProps {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_SET.has(key)));
}

/**
 * The platform's settings for native: the app's `ios` or `android` roots with the cross-platform props on top. A
 * cross-platform prop that is unset resets its key to the default (the user agent, playback, windows, debugging), so
 * removing the prop undoes it; the app's own key for it comes between the two.
 */
function platformSettings(props: WebViewProps): NativeSettings {
  const set = <T,>(
    value: T | undefined,
    key: string,
    map: (value: T) => SettingValue = (v) => v as never
  ) => (value === undefined ? {} : { [key]: map(value) });
  const inspectable = props.webviewDebuggingEnabled;
  const windows = props.javaScriptCanOpenWindowsAutomatically;
  if (Platform.OS === 'ios') {
    const { configuration, preferences, webView, ...rest } = props.ios ?? {};
    return {
      ...rest,
      configuration: {
        mediaTypesRequiringUserActionForPlayback: MEDIA_ALL,
        ...configuration,
        ...set(props.applicationNameForUserAgent, 'applicationNameForUserAgent'),
        ...set(
          props.mediaPlaybackRequiresUserAction,
          'mediaTypesRequiringUserActionForPlayback',
          (v) => (v ? MEDIA_ALL : 0)
        ),
      },
      preferences: {
        javaScriptCanOpenWindowsAutomatically: false,
        ...preferences,
        ...set(windows, 'javaScriptCanOpenWindowsAutomatically'),
      },
      webView: {
        customUserAgent: null,
        inspectable: __DEV__,
        ...webView,
        ...set(props.userAgent, 'customUserAgent'),
        ...set(inspectable, 'inspectable'),
      },
    };
  }
  if (Platform.OS !== 'android') return {};
  const { settings, webView } = props.android ?? {};
  return {
    settings: {
      userAgentString: null,
      mediaPlaybackRequiresUserGesture: true,
      javaScriptCanOpenWindowsAutomatically: false,
      ...settings,
      ...set(
        props.applicationNameForUserAgent,
        'userAgentString',
        (name) => `${nativeModule().defaultUserAgent} ${name}`
      ),
      ...set(props.userAgent, 'userAgentString'),
      ...set(props.mediaPlaybackRequiresUserAction, 'mediaPlaybackRequiresUserGesture'),
      ...set(windows, 'javaScriptCanOpenWindowsAutomatically'),
    },
    webView: {
      webContentsDebuggingEnabled: __DEV__,
      ...webView,
      ...set(inspectable, 'webContentsDebuggingEnabled'),
    },
  };
}

/** Settings keys native could not apply. */
function warnRejected(payload: Record<string, unknown>) {
  for (const { key, reason } of (payload['rejected'] ?? []) as { key: string; reason: string }[]) {
    console.warn(`[minimal-rn-webview] ${Platform.OS}.${key}: ${reason}`);
  }
}

/**
 * Load events and the overlay state. The current load's main-frame error: onLoad fires only without one, and
 * renderError shows it until the next load starts.
 */
function useLoadEvents(props: WebViewProps, attachmentRef: RefObject<Attachment | undefined>) {
  const lastRef = useRef(INITIAL_STATE);
  const [error, setError] = useState<WebViewErrorEvent | null>(null);
  const errorRef = useRef<WebViewErrorEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const onNavigationState = ({ nativeEvent: state }: NativeEvent<NavigationState>) => {
    const was = lastRef.current.loading;
    lastRef.current = state;
    attachmentRef.current?.update(state);
    setLoading(state.loading);
    props.onNavigationStateChange?.(state);
    if (!was && state.loading) {
      errorRef.current = null;
      setError(null);
      props.onLoadStart?.(state);
    }
    if (was && !state.loading) {
      if (!errorRef.current) props.onLoad?.(state);
      props.onLoadEnd?.(state);
    }
  };

  // An HTTP status (404, 503) still shows the site's own error page: only network and SSL failures count as a failed
  // load (no onLoad, renderError shown).
  const onError = ({
    nativeEvent: { kind, url, code, description },
  }: NativeEvent<NativeErrorEvent>) => {
    if (kind === 'http') {
      props.onHttpError?.({ url, statusCode: code, description });
      return;
    }
    const failure = { kind, url, code, description };
    errorRef.current = failure;
    setError(failure);
    props.onError?.(failure);
  };

  return { error, loading, onNavigationState, onError, lastRef };
}

/** The error screen wins over the loading screen; both cover the WebView until the next load starts or finishes. */
function withOverlay(
  webView: ReactElement,
  props: WebViewProps,
  error: WebViewErrorEvent | null,
  loading: boolean
) {
  if (!props.renderLoading && !props.renderError) return webView;
  const overlay = error ? props.renderError?.(error) : loading ? props.renderLoading?.() : null;
  return (
    <View {...viewPropsOf(props)}>
      {webView}
      {overlay ? <View style={StyleSheet.absoluteFill}>{overlay}</View> : null}
    </View>
  );
}

let androidInfo: AndroidWebViewInfo | undefined;
export declare namespace WebView {
  /**
   * The Android WebView provider and which of the WebView features this package uses it supports. Null on iOS. Fixed
   * for the life of the process: a WebView update restarts the app.
   */
  const androidWebViewInfo: AndroidWebViewInfo | null;
}
Object.defineProperty(WebView, 'androidWebViewInfo', {
  get: (): AndroidWebViewInfo | null =>
    Platform.OS === 'android' ? (androidInfo ??= nativeModule().androidWebViewInfo) : null,
});

const styles = StyleSheet.create({ fill: { flex: 1 } });

/**
 * The navigation state of the WebView mounted with `ref` (a `useRef`, `createRef` or `createWebViewRef` one); re-renders
 * on every change, and follows a remount. The initial state while none is mounted.
 */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState {
  const { nav } = adapterFor(ref);
  return useSyncExternalStore(nav.subscribe, nav.getState);
}
