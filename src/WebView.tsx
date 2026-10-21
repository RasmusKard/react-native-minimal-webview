import { requireNativeModule, requireNativeView } from 'expo';
import {
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
import { Platform, type ViewProps } from 'react-native';

import { type BridgeConnection, CONNECTION } from './bridge/createBridge';
import { WK } from './platform.generated';
import type {
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

/** A page's message comes with its origin, as native verified it (`location.origin` form). */
type BridgeEvent =
  { message: string; origin: string } | { navigated: true } | { unavailable: true };

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
} as const;
/** The core's own events; everything else is a hook's, for `onNativeEvent`. */
const CORE = 'core.';

/** Every prop that is not a `ViewProps` one, so it never reaches the outermost view. */
const OWN = [
  'source',
  'ios',
  'android',
  'userAgent',
  'navigationRules',
  'injectedScripts',
  'bridge',
  'pullToRefresh',
  'sharedCookies',
  'nativeOptions',
  'onNativeEvent',
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
  /**
   * `{ get }` reads a setting, `{ call, args, completion }` calls a platform method: the JSON of the result. `args` is
   * JSON too, so that a `null` argument survives the native dictionary conversion.
   */
  native(request: {
    get?: string;
    call?: string;
    args?: string;
    completion?: string;
  }): Promise<string>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');
const nativeModule = () =>
  requireNativeModule<{
    defaultUserAgent: string;
    warmUp(): void;
    preconnect(url: string): Promise<void>;
  }>('MinimalWebView');

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
 * A ref to pass as a WebView's `ref`, made outside React (a module, a store) so code outside React can use it. Its
 * `current` is whichever WebView is mounted with it, and it keeps its subscribers across remounts.
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

type Props = WebViewProps & { ref?: Ref<WebViewRef> };

export function WebView(props: Props) {
  return <WebViewInstance key={creationKey(props)} {...props} />;
}

/** One native WebView's life: a new creation key remounts it, so its state, ref attachment and bridge start over. */
function WebViewInstance({ ref, ...props }: Props) {
  const native = useRef<NativeMethods>(null);
  const attachmentRef = useRef<Attachment>(undefined);
  const { onNavigationState, onError, lastRef } = useLoadEvents(props, attachmentRef);

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
      get: async (key) => parsed(await native.current?.native({ get: key })),
      call: async (method, args = [], options) =>
        parsed(
          await native.current?.native({
            call: method,
            args: JSON.stringify(args),
            completion: options?.completion,
          })
        ),
    };
  });
  useAttach(ref, handle, lastRef, attachmentRef);

  // The same string while nothing in it changed, so a re-render sends native nothing.
  const settings = JSON.stringify(platformSettings(props));
  const connection =
    props.bridge && (props.bridge as Bridge & { [CONNECTION]: BridgeConnection })[CONNECTION];
  useEffect(() => {
    if (!connection) return undefined;
    connection.attach((message) => void native.current?.bridgePost(message));
    return () => connection.detach();
  }, [connection]);

  const onBridge = ({ nativeEvent }: NativeEvent<BridgeEvent>) => {
    if ('message' in nativeEvent) connection?.receive(nativeEvent.message, nativeEvent.origin);
    else if ('navigated' in nativeEvent) connection?.navigated();
    else connection?.markUnavailable();
  };

  const answer = (askId: number, value: unknown) =>
    native.current?.answer(askId, { value: value ?? null });

  const requestHandlers = useRequestHandlers(props);

  // One per ask in flight, by id: aborted when native stops waiting (`core.askCancelled`) or at unmount.
  const [asks] = useState(() => new Map<number, AbortController>());
  useEffect(() => () => asks.forEach((controller) => controller.abort()), [asks]);

  const onNativeEvent = async ({
    nativeEvent: { name, payload, askId },
  }: NativeEvent<HookEvent>) => {
    if (name === `${CORE}warning`)
      return console.warn(`[minimal-rn-webview] ${String(payload['message'])}`);
    if (name === `${CORE}askCancelled`) return asks.get(payload['askId'] as number)?.abort();
    const request = name.startsWith(CORE)
      ? REQUESTS[name.slice(CORE.length) as keyof typeof REQUESTS]
      : undefined;
    const handler = request
      ? (props[request] as ((payload: unknown, signal?: AbortSignal) => unknown) | undefined)
      : (_: unknown, signal?: AbortSignal) => props.onNativeEvent?.({ name, payload }, signal);
    const controller = new AbortController();
    if (askId !== undefined) asks.set(askId, controller);
    const value = await settle(
      () => handler?.(payload, askId === undefined ? undefined : controller.signal),
      // Native counts a missing answer as `block` too.
      request === 'onNavigationRequest' ? 'block' : null,
      request ? `${request} failed` : `onNativeEvent failed for ${name}`
    );
    if (askId === undefined) return;
    asks.delete(askId);
    // Native already answered a cancelled ask with null; a late answer would find nothing.
    if (!controller.signal.aborted) await answer(askId, value);
  };

  const onNavigation = ({ nativeEvent }: NativeEvent<NavigationEvent>) => {
    if (nativeEvent.action === 'external') props.onOpenExternal?.(nativeEvent.url);
    props.onNavigation?.(nativeEvent);
  };

  return (
    <NativeWebView
      {...viewPropsOf(props)}
      ref={native}
      source={props.source}
      settings={settings}
      pullToRefresh={props.pullToRefresh ?? false}
      sharedCookies={Platform.OS === 'ios' ? (props.sharedCookies ?? false) : undefined}
      navigationRules={props.navigationRules}
      injectedScripts={props.injectedScripts}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      nativeOptions={props.nativeOptions}
      requestHandlers={requestHandlers}
      onNavigation={onNavigation}
      onNavigationState={onNavigationState}
      onBridge={onBridge}
      onNativeEvent={onNativeEvent}
      onError={onError}
      onProcessGone={({ nativeEvent }) => props.onProcessGone?.(nativeEvent)}
    />
  );
}

/**
 * Puts `handle` in a callback or plain ref. Any ref object also gets the navigation state through its adapter, which a
 * createWebViewRef one is, so its `current` comes from the adapter too.
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

/** Bridges by identity, for the creation key. */
const bridgeIds = new WeakMap<object, number>();
let lastBridgeId = 0;

/**
 * What native sets up once, when it creates the WebView: the bridge, the hooks' options and the creation-time
 * settings (`ios.configuration`). As WebViewInstance's `key`, a change recreates the WebView, like a new `key` on the
 * component would: the page reloads from `source`, and the navigation state starts from the initial one.
 */
function creationKey(props: WebViewProps) {
  const bridge = props.bridge;
  let id = bridge && bridgeIds.get(bridge);
  if (bridge && id === undefined) bridgeIds.set(bridge, (id = ++lastBridgeId));
  return JSON.stringify(
    [id ?? 0, props.nativeOptions, Platform.OS === 'ios' ? props.ios?.configuration : undefined],
    sortedKeys
  );
}

/** A JSON.stringify replacer: the same options in another key order are the same key. */
const sortedKeys = (_: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort())
    : value;

/** `style`, `testID`, the accessibility props and the other ViewProps, for the native view. */
function viewPropsOf(props: WebViewProps): ViewProps {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_SET.has(key)));
}

/**
 * The platform's settings for native: the package's defaults (playback on a gesture, no script-opened windows,
 * debugging in `__DEV__`, no custom user agent), the app's `ios` or `android` roots over them, and `userAgent` on
 * top. An unset `userAgent` resets its key to the default, so removing the prop undoes it.
 */
function platformSettings(props: WebViewProps): NativeSettings {
  const set = (value: string | undefined, key: string) =>
    value === undefined ? {} : { [key]: value };
  if (Platform.OS === 'ios') {
    const { configuration, preferences, webView, ...rest } = props.ios ?? {};
    return {
      ...rest,
      configuration: { mediaTypesRequiringUserActionForPlayback: MEDIA_ALL, ...configuration },
      preferences: { javaScriptCanOpenWindowsAutomatically: false, ...preferences },
      webView: {
        customUserAgent: null,
        inspectable: __DEV__,
        ...webView,
        ...set(props.userAgent, 'customUserAgent'),
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
      ...set(props.userAgent, 'userAgentString'),
    },
    webView: { webContentsDebuggingEnabled: __DEV__, ...webView },
  };
}

/** Load events. The current load's main-frame error: onLoad fires only without one. */
function useLoadEvents(props: WebViewProps, attachmentRef: RefObject<Attachment | undefined>) {
  const lastRef = useRef(INITIAL_STATE);
  const errorRef = useRef<WebViewErrorEvent | null>(null);

  const onNavigationState = ({ nativeEvent: state }: NativeEvent<NavigationState>) => {
    const was = lastRef.current.loading;
    lastRef.current = state;
    attachmentRef.current?.update(state);
    props.onNavigationStateChange?.(state);
    if (!was && state.loading) {
      errorRef.current = null;
      props.onLoadStart?.(state);
    }
    if (was && !state.loading) {
      if (!errorRef.current) props.onLoad?.(state);
      props.onLoadEnd?.(state);
    }
  };

  // An HTTP status (404, 503) still shows the site's own error page: only network and SSL failures count as a failed
  // load (no onLoad).
  const onError = ({
    nativeEvent: { kind, url, code, description },
  }: NativeEvent<NativeErrorEvent>) => {
    if (kind === 'http') {
      props.onHttpError?.({ url, statusCode: code, description });
      return;
    }
    const failure = { kind, url, code, description };
    errorRef.current = failure;
    props.onError?.(failure);
  };

  return { onNavigationState, onError, lastRef };
}

export declare namespace WebView {
  /**
   * Android's default user agent, for `android.settings.userAgentString` with a suffix. Null on iOS, where
   * `ios.configuration.applicationNameForUserAgent` appends.
   */
  const defaultUserAgent: string | null;
}
Object.defineProperty(WebView, 'defaultUserAgent', {
  get: (): string | null => (Platform.OS === 'android' ? nativeModule().defaultUserAgent : null),
});
/**
 * Android: starts WebView (its code and Chromium) in the background, so that the first WebView mounts faster and blocks
 * the UI thread less. Call it at app start when a WebView will show soon after. No-op on iOS.
 */
WebView.warmUp = (): void => {
  if (Platform.OS === 'android') nativeModule().warmUp();
};
/**
 * Android: opens a connection to `url`'s origin (DNS, TCP, TLS) for a load that follows. Starts WebView if nothing has
 * yet. No-op on iOS.
 */
WebView.preconnect = (url: string): void => {
  if (Platform.OS === 'android') void nativeModule().preconnect(url);
};

/**
 * The navigation state of the WebView mounted with `ref` (a `useRef`, `createRef` or `createWebViewRef` one); re-renders
 * on every change, and follows a remount. The initial state while none is mounted.
 */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState {
  const { nav } = adapterFor(ref);
  return useSyncExternalStore(nav.subscribe, nav.getState);
}
