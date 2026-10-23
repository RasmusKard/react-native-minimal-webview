import { requireNativeModule, requireNativeView } from 'expo';
import { type Ref, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, type ViewProps } from 'react-native';

import { CONNECTION } from './bridge/createBridge';
import { bridgeError } from './bridge/endpoint';
import { type Attachment, INITIAL_STATE, useAttach } from './refStore';
import type {
  HookEvent,
  LoadErrorEvent,
  NavigationEvent,
  NavigationState,
  ProcessGoneEvent,
  SettingValue,
  WebViewProps,
  WebViewRef,
} from './types';

type Native<T> = { nativeEvent: T };
/** The native view's event props, by name and payload. */
type NativeHandlers<E> = { [K in keyof E]: (event: Native<E[K]>) => void };

/**
 * A type's documented keys, to pick from its native event: React Native adds its own (`target`, the view's tag). A
 * `Record`, so that a key missing here, or not in the type, fails to compile.
 */
const keysOf = <T,>(keys: Record<keyof T, true>) => Object.keys(keys) as (keyof T)[];
const pick = <T,>(event: T, keys: (keyof T)[]) =>
  Object.fromEntries(keys.map((key) => [key, event[key]])) as T;
const STATE_KEYS = keysOf<NavigationState>({
  url: true,
  pendingUrl: true,
  title: true,
  loading: true,
  progress: true,
  canGoBack: true,
  canGoForward: true,
  outcome: true,
});
const NAVIGATION_KEYS = keysOf<NavigationEvent>({
  url: true,
  mainFrame: true,
  newWindow: true,
  userInitiated: true,
  action: true,
  rule: true,
});
const PROCESS_GONE_KEYS = keysOf<ProcessGoneEvent>({ didCrash: true, recovered: true });

/** Native reports every main-frame error as one event; `code` is the HTTP status for `http`. */
export type NativeErrorEvent = {
  kind: LoadErrorEvent['kind'];
  url: string;
  code: number;
  description: string;
};

/** A page's message comes with its origin, as native verified it (`location.origin` form). */
export type BridgeEvent =
  { message: string; origin: string } | { navigated: true } | { unavailable: true };

/** `askId` is set when native waits for the answer (`WebViewContext.ask`). */
export type AskableEvent = HookEvent & { askId?: number };

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
/** The core's own events; everything else is a hook's, for `onHookEvent`. */
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
  'hookOptions',
  'onHookEvent',
  'onNavigation',
  'onNavigationStateChange',
  'onError',
  'onProcessGone',
  'onLoadStart',
  'onLoadEnd',
  ...Object.values(REQUESTS),
  'ref',
  'children',
] as const satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[];
type Unlisted = Exclude<Exclude<keyof WebViewProps, keyof ViewProps>, (typeof OWN)[number]>;
// A prop missing from OWN fails to compile here, by name.
const OWN_SET: Set<string> &
  ([Unlisted] extends [never] ? unknown : Record<Unlisted, 'missing from OWN'>) = new Set(OWN);

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
    hookOptions: Record<string, unknown> | undefined;
    requestHandlers: string[];
  } & NativeHandlers<{
    onNavigation: NavigationEvent;
    onNavigationState: NavigationState;
    onBridge: BridgeEvent;
    onHookEvent: AskableEvent;
    onError: NativeErrorEvent;
    onProcessGone: ProcessGoneEvent;
  }>;

type NativeMethods = {
  navigate(action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  bridgePost(message: string): Promise<void>;
  /** Answers a native `ask`. The value is wrapped: native arguments can't be of any type. */
  answer(askId: number, answer: { value: unknown }): Promise<void>;
  /** The JSON-encoded result. */
  evaluate(script: string): Promise<string>;
  /** Reads a platform setting: the JSON of its value. */
  get(path: string): Promise<string>;
  /**
   * Calls a platform method: the JSON of its result. `argsJson` is JSON, so that a `null` argument survives the native
   * conversion. `completion` is iOS's handler shape.
   */
  call(path: string, argsJson: string, completion: string | null): Promise<string>;
  /** A hook's `context.handle` handler: the JSON of its reply. `args` is JSON, as for `call`. */
  hook(name: string, method: string, args: string): Promise<string>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');
const nativeModule = () =>
  requireNativeModule<{
    defaultUserAgent: string;
    warmUp(): void;
    preconnect(url: string): Promise<void>;
  }>('MinimalWebView');

/** Runs a JS handler that native waits on: one that throws still answers, with the safe default. */
const settle = <T,>(handler: () => T | Promise<T>, fallback: T, failure: string) =>
  Promise.resolve()
    .then(handler)
    .catch((error: unknown) => {
      console.error(`[react-native-minimal-webview] ${failure}`, error);
      return fallback;
    });

export function WebView(props: WebViewProps) {
  return <WebViewInstance key={creationKey(props)} {...props} />;
}

/** One native WebView's life: a new creation key remounts it, so its state, ref attachment and bridge start over. */
function WebViewInstance({ ref, ...props }: WebViewProps) {
  const native = useRef<NativeMethods>(null);
  const attachmentRef = useRef<Attachment>(undefined);
  const { onNavigationState, onError, lastRef } = useLoadEvents(props, attachmentRef);

  // A handle can outlive its native view (one captured before an unmount): navigation is then a no-op, and what
  // answers rejects with `unavailable`.
  const [handle] = useState((): WebViewRef => {
    const parsed = (json: string) => JSON.parse(json) as unknown;
    const gone = (): never => {
      throw bridgeError({ code: 'unavailable', message: 'the WebView is gone' });
    };
    return {
      goBack: () => void native.current?.navigate('back'),
      goForward: () => void native.current?.navigate('forward'),
      reload: () => void native.current?.navigate('reload'),
      stopLoading: () => void native.current?.navigate('stop'),
      evaluate: async (script) => parsed(await (native.current?.evaluate(script) ?? gone())),
      get: async (key) => parsed(await (native.current?.get(key) ?? gone())),
      call: async (method, args = [], options) =>
        parsed(
          await (native.current?.call(method, JSON.stringify(args), options?.completion ?? null) ??
            gone())
        ),
      hook: async (name, method, args = []) =>
        parsed(await (native.current?.hook(name, method, JSON.stringify(args)) ?? gone())),
    };
  });
  useAttach(ref, handle, lastRef, attachmentRef);

  // The same string while nothing in it changed, so a re-render sends native nothing.
  const settings = JSON.stringify(platformSettings(props));
  const connection = props.bridge?.[CONNECTION];
  useEffect(() => {
    if (!connection) return undefined;
    connection.attach((message) => void native.current?.bridgePost(message));
    return () => connection.detach();
  }, [connection]);

  const onBridge = ({ nativeEvent }: Native<BridgeEvent>) => {
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

  const onHookEvent = async ({ nativeEvent: { name, payload, askId } }: Native<AskableEvent>) => {
    if (name === `${CORE}warning`)
      return console.warn(`[react-native-minimal-webview] ${String(payload['message'])}`);
    if (name === `${CORE}askCancelled`) return asks.get(payload['askId'] as number)?.abort();
    const request = name.startsWith(CORE)
      ? REQUESTS[name.slice(CORE.length) as keyof typeof REQUESTS]
      : undefined;
    const handler = request
      ? (props[request] as ((payload: unknown, signal?: AbortSignal) => unknown) | undefined)
      : (_: unknown, signal?: AbortSignal) => props.onHookEvent?.({ name, payload }, signal);
    // Only an ask can be cancelled, so only an ask gets a signal.
    let controller: AbortController | undefined;
    if (askId !== undefined) {
      controller = new AbortController();
      asks.set(askId, controller);
    }
    const value = await settle(
      () => handler?.(payload, controller?.signal),
      // Native counts a missing answer as `block` too.
      request === 'onNavigationRequest' ? 'block' : null,
      request ? `${request} failed` : `onHookEvent failed for ${name}`
    );
    if (askId === undefined) return;
    asks.delete(askId);
    // Native already answered a cancelled ask with null; a late answer would find nothing.
    if (!controller?.signal.aborted) await answer(askId, value);
  };

  const onNavigation = ({ nativeEvent }: Native<NavigationEvent>) => {
    const event = pick(nativeEvent, NAVIGATION_KEYS);
    if (event.action === 'external') props.onOpenExternal?.(event.url);
    props.onNavigation?.(event);
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
      hookOptions={props.hookOptions && withoutNulls(props.hookOptions)}
      requestHandlers={requestHandlers}
      onNavigation={onNavigation}
      onNavigationState={({ nativeEvent }) =>
        onNavigationState({ nativeEvent: pick(nativeEvent, STATE_KEYS) })
      }
      onBridge={onBridge}
      onHookEvent={onHookEvent}
      onError={onError}
      onProcessGone={({ nativeEvent }) =>
        props.onProcessGone?.(pick(nativeEvent, PROCESS_GONE_KEYS))
      }
    />
  );
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
 * What native sets up once, when it creates the WebView: the bridge and the creation-time settings
 * (`ios.configuration`). As WebViewInstance's `key`, a change recreates the WebView, like a new `key` on the component
 * would: the page reloads from `source`, and the navigation state starts from the initial one. `hookOptions` is not
 * in it: native passes a changed value to its hook live.
 */
function creationKey(props: WebViewProps) {
  const bridge = props.bridge;
  let id = bridge && bridgeIds.get(bridge);
  if (bridge && id === undefined) bridgeIds.set(bridge, (id = ++lastBridgeId));
  return JSON.stringify(
    [id ?? 0, Platform.OS === 'ios' ? props.ios?.configuration : undefined],
    sortedKeys
  );
}

/** A null or undefined value is no value: the hook is off, and for an attached one the key is removed. */
const withoutNulls = (options: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => value != null));

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
 * The platform's settings for native: the package's defaults (inline media on iOS, debugging in `__DEV__`, no custom
 * user agent), the app's `ios` or `android` roots over them, and `userAgent` on top. An unset `userAgent` resets its key
 * to the default, so removing the prop undoes it.
 */
function platformSettings(props: WebViewProps): NativeSettings {
  const set = (value: string | undefined, key: string) =>
    value === undefined ? {} : { [key]: value };
  if (Platform.OS === 'ios') {
    const { configuration, webView, ...rest } = props.ios ?? {};
    return {
      ...rest,
      configuration: { allowsInlineMediaPlayback: true, ...configuration },
      webView: {
        customUserAgent: null,
        inspectable: __DEV__,
        ...webView,
        ...set(props.userAgent, 'customUserAgent'),
      },
    };
  }
  const { settings, webView } = props.android ?? {};
  return {
    settings: {
      userAgentString: null,
      ...settings,
      ...set(props.userAgent, 'userAgentString'),
    },
    webView: { webContentsDebuggingEnabled: __DEV__, ...webView },
  };
}

/** Load events: onLoadStart and onLoadEnd are the edges of `loading`; native sets the ended load's `outcome`. */
function useLoadEvents(props: WebViewProps, attachmentRef: RefObject<Attachment | undefined>) {
  const lastRef = useRef(INITIAL_STATE);

  const onNavigationState = ({ nativeEvent: state }: Native<NavigationState>) => {
    const was = lastRef.current.loading;
    lastRef.current = state;
    attachmentRef.current?.update(state);
    props.onNavigationStateChange?.(state);
    if (!was && state.loading) props.onLoadStart?.(state);
    if (was && !state.loading) props.onLoadEnd?.(state);
  };

  // An HTTP error's description is the platform's own text (an empty HTTP/2 reason phrase on Android): not passed on.
  const onError = ({ nativeEvent: { kind, url, code, description } }: Native<NativeErrorEvent>) =>
    props.onError?.(
      kind === 'http' ? { kind, url, statusCode: code } : { kind, url, code, description }
    );

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
