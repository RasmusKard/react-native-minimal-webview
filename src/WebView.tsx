import { requireNativeModule, requireNativeView } from 'expo';
import { type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type ViewProps } from 'react-native';

import { CONNECTION, originGuard } from './bridge/createBridge';
import { codedError } from './bridge/endpoint';
import { defaultNavigationRules } from './defaultNavigationRules';
import { REACT_NATIVE_WEBVIEW_DEFAULTS } from './reactNativeWebViewDefaults';
import { useAttach } from './refStore';
import type {
  Bridge,
  HookExtension,
  InjectedScript,
  LoadErrorEvent,
  NavigationEvent,
  NavigationState,
  ProcessGoneEvent,
  SettingValue,
  WebViewProps,
  WebViewRef,
} from './types';
import { DEFAULTS } from './types.defaults';

type Native<T> = { nativeEvent: T };
/** The native view's event props, by name and payload. */
type NativeHandlers<E> = { [K in keyof E]: (event: Native<E[K]>) => void };

/** The event without the `target` (the view's tag) React Native adds to every native event. */
const own = <T,>({ target: _, ...event }: T & { target?: unknown }) => event as T;

/** A page's message comes with its origin, as native verified it (`location.origin` form). */
export type BridgeEvent =
  { message: string; origin: string } | { navigated: true } | { unavailable: true };

/**
 * An event as native sends it: `key` is the hook's key, `core` for the core's own. `askId` is set when native waits for
 * the answer.
 */
export type AskableEvent = {
  key: string;
  name: string;
  payload: Record<string, unknown>;
  askId?: number;
};

/**
 * Page requests the core answers natively, by prop name, and `onNavigation`, for the decisions it reports. Native sends
 * JS each only while its prop is set, and reads the set when it would send one, so a prop can come and go.
 */
const REQUESTS = [
  'onNavigationRequest',
  'onOpenExternal',
  'onFileRequest',
  'onFullscreenChange',
  'onPermissionRequest',
  'onDownload',
  'onNavigation',
] as const;

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
  'extensions',
  'onNavigationStateChange',
  'onError',
  'onProcessGone',
  'onLoadStart',
  'onLoadEnd',
  ...REQUESTS,
  'ref',
  'children',
] as const satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[];
type Unlisted = Exclude<Exclude<keyof WebViewProps, keyof ViewProps>, (typeof OWN)[number]>;
// A prop missing from OWN fails to compile here, by name.
const OWN_SET: Set<string> &
  ([Unlisted] extends [never] ? unknown : Record<Unlisted, 'missing from OWN'>) = new Set(OWN);

type NativeSettings = Record<string, Record<string, SettingValue | undefined>>;

type NativeProps = ViewProps &
  Pick<WebViewProps, 'source' | 'navigationRules' | 'pullToRefresh'> & {
    /** With each script's `origins` in its code (`nativeScripts`). */
    injectedScripts: Omit<InjectedScript, 'origins'>[] | undefined;
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
    onError: LoadErrorEvent;
    onProcessGone: ProcessGoneEvent;
  }>;

/** The native view's methods, on its ref. */
export type NativeMethods = {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
  bridgePost(message: string): Promise<void>;
  /** Answers a native `ask`. `json` is JSON, as for `call`. */
  answer(askId: number, json: string): Promise<void>;
  /** The JSON-encoded result. */
  evaluate(script: string): Promise<string>;
  /** Reads a platform setting: the JSON of its value. */
  get(path: string): Promise<string>;
  /**
   * Calls a platform method: the JSON of its result. `argsJson` is JSON, so that a `null` argument survives the native
   * conversion.
   */
  call(path: string, argsJson: string): Promise<string>;
  /** A hook's `context.handle` handler: the JSON of its reply. `args` is JSON, as for `call`. */
  hook(name: string, method: string, args: string): Promise<string>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');
const nativeModule = () =>
  requireNativeModule<{
    defaultUserAgent: string;
    warmUp(): void;
    preconnect(url: string): Promise<void>;
    setWebContentsDebuggingEnabled(enabled: boolean): Promise<void>;
  }>('MinimalWebView');

/**
 * A WebView whose native side decides navigations and owns the navigation state: see {@link WebViewProps} and
 * {@link WebViewRef}.
 * @group WebView
 */
export function WebView(props: WebViewProps) {
  useBridgeChangeWarning(props.bridge);
  return <WebViewInstance key={creationKey(props)} {...props} />;
}

/**
 * Warns in development, once per WebView, when another bridge replaces its bridge, which recreated it: a bridge made
 * in render (`bridge={createBridge(…)}`) would reload the page at every render.
 */
function useBridgeChangeWarning(bridge: Bridge | undefined) {
  const last = useRef(bridge);
  const warned = useRef(false);
  useEffect(() => {
    if (__DEV__ && !warned.current && last.current && bridge && bridge !== last.current) {
      warned.current = true;
      console.warn(
        '[react-native-minimal-webview] bridge: another bridge recreated the WebView, and its page loaded again; ' +
          'create the bridge once, at module scope or with useMemo'
      );
    }
    last.current = bridge;
  }, [bridge]);
}

/** One native WebView's life: a new creation key remounts it, so its state, ref attachment and bridge start over. */
function WebViewInstance({ ref, ...props }: WebViewProps) {
  const native = useRef<NativeMethods>(null);

  // The rejecters of native calls not settled yet. An unmount rejects them: native may never answer (a hook handler
  // that never replies), and a late answer then settles nothing.
  const [inFlight] = useState(() => new Set<(error: Error) => void>());
  useEffect(
    () => () => {
      const message = 'the WebView unmounted before the call was answered';
      inFlight.forEach((reject) => reject(codedError({ code: 'navigated', message })));
      inFlight.clear();
    },
    [inFlight]
  );

  // A handle can outlive its native view (one captured before an unmount): navigation is then a no-op, and what
  // answers rejects with `unavailable`.
  const [handle] = useState((): WebViewRef => {
    const gone = (): never => {
      throw codedError({ code: 'unavailable', message: 'the WebView is gone' });
    };
    const settled = (promise: Promise<string>) =>
      new Promise<string>((resolve, reject) => {
        inFlight.add(reject);
        promise.then(
          (value) => {
            inFlight.delete(reject);
            resolve(value);
          },
          (error: unknown) => {
            inFlight.delete(reject);
            reject(error);
          }
        );
      });
    // Android rejects a view function with ERR_VIEW_NOT_FOUND until Expo has registered the view: retry each frame.
    const mounted = async (call: () => Promise<string> | undefined) => {
      for (let frame = 0; ; frame++) {
        try {
          return JSON.parse(await settled(call() ?? gone())) as unknown;
        } catch (error) {
          if ((error as { code?: string }).code !== 'ERR_VIEW_NOT_FOUND') throw error;
          if (frame === 60 || AppState.currentState === 'background') gone();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
    };
    return {
      goBack: () => void native.current?.goBack(),
      goForward: () => void native.current?.goForward(),
      reload: () => void native.current?.reload(),
      stopLoading: () => void native.current?.stopLoading(),
      evaluate: (script) => mounted(() => native.current?.evaluate(script)),
      get: (key) => mounted(() => native.current?.get(key)),
      call: (method, args = []) =>
        mounted(() => native.current?.call(method, JSON.stringify(args))),
      hook: (name, method, args = []) =>
        mounted(() => native.current?.hook(name, method, JSON.stringify(args))),
    };
  });
  const publish = useAttach(ref, handle);

  // onLoadStart and onLoadEnd are the edges of `loading`; native sets the ended load's `outcome`.
  const onNavigationState = ({ nativeEvent }: Native<NavigationState>) => {
    const state = own(nativeEvent);
    const was = publish(state);
    props.onNavigationStateChange?.(state);
    if (!was.loading && state.loading) props.onLoadStart?.(state);
    if (was.loading && !state.loading) props.onLoadEnd?.(state);
  };

  // The same string while nothing in it changed, so a re-render sends native nothing.
  const settings = JSON.stringify(platformSettings(props));
  const injectedScripts = useMemo(
    () => nativeScripts(props.injectedScripts),
    [props.injectedScripts]
  );
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

  const requestHandlers = useRequestHandlers(props);
  const hookOptions = useHookOptions(props.extensions);

  // One per ask in flight, by id: aborted when native stops waiting (the core's `askCancelled`) or at unmount.
  const [asks] = useState(() => new Map<number, AbortController>());
  useEffect(() => () => asks.forEach((controller) => controller.abort()), [asks]);

  // The core's own events: a warning for the developer, and an ask native stopped waiting for.
  const onCoreEvent = (name: string, payload: Record<string, unknown>) => {
    if (name === 'warning')
      console.warn(`[react-native-minimal-webview] ${String(payload['message'])}`);
    else if (name === 'askCancelled') asks.get(payload['askId'] as number)?.abort();
    else return false;
    return true;
  };

  const onHookEvent = async ({
    nativeEvent: { key, name, payload, askId },
  }: Native<AskableEvent>) => {
    const core = key === 'core';
    if (core && onCoreEvent(name, payload)) return;
    const request = REQUESTS.find((prop) => core && prop === name);
    // The later of two extensions with one key, as in useHookOptions. No hook is registered under `core`.
    const owner = props.extensions?.findLast((e): e is HookExtension => !!e && e.key === key);
    const handler = request
      ? (props[request] as ((payload: unknown, signal?: AbortSignal) => unknown) | undefined)
      : (_: unknown, signal?: AbortSignal) => owner?.onEvent?.({ name, payload }, signal);
    // Only an ask can be cancelled, so only an ask gets a signal.
    let controller: AbortController | undefined;
    if (askId !== undefined) {
      controller = new AbortController();
      asks.set(askId, controller);
    }
    const failure = request ? `${request} failed` : `onEvent failed for ${key}.${name}`;
    let value: unknown = null;
    try {
      value = await handler?.(payload, controller?.signal);
    } catch (error) {
      // Native waits on this handler: one that throws still answers, with null (native's safe default).
      console.error(`[react-native-minimal-webview] ${failure}`, error);
    }
    if (askId === undefined) return;
    asks.delete(askId);
    // Native already answered a cancelled ask with null; a late answer would find nothing.
    if (!controller?.signal.aborted) await native.current?.answer(askId, answerJson(value));
  };

  return (
    <NativeWebView
      {...viewPropsOf(props)}
      ref={native}
      source={props.source}
      settings={settings}
      pullToRefresh={props.pullToRefresh}
      sharedCookies={Platform.OS === 'ios' ? props.sharedCookies : undefined}
      navigationRules={props.navigationRules ?? defaultNavigationRules}
      injectedScripts={injectedScripts}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      hookOptions={hookOptions}
      requestHandlers={requestHandlers}
      onNavigation={({ nativeEvent }) => props.onNavigation?.(own(nativeEvent))}
      onNavigationState={onNavigationState}
      onBridge={onBridge}
      onHookEvent={onHookEvent}
      onError={({ nativeEvent }) => props.onError?.(own(nativeEvent))}
      onProcessGone={({ nativeEvent }) => props.onProcessGone?.(own(nativeEvent))}
    />
  );
}

/** An ask's answer for native: null for one JSON can't encode (a function, a cycle, a BigInt), so the ask settles. */
function answerJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

/**
 * The scripts as native runs them: one whose `origins` lack `*` runs inside a function, so that even its function
 * declarations take effect only where the guard lets it run.
 */
function nativeScripts(scripts: InjectedScript[] | undefined) {
  return scripts?.map(({ code, allFrames, origins }) => {
    if (!Array.isArray(origins))
      throw new Error("injectedScripts: every script needs origins (['*'] for every origin)");
    const guard = originGuard('injectedScripts: invalid origins', origins);
    return { code: guard ? `if (${guard}) (() => {\n${code}\n})();` : code, allFrames };
  });
}

/** The `REQUESTS` with a prop set, as a new array only when that set changes. */
function useRequestHandlers(props: WebViewProps) {
  const key = REQUESTS.filter((prop) => props[prop]).join();
  return useMemo(() => (key ? key.split(',') : []), [key]);
}

/**
 * Native's `hookOptions`: each extension's `options` by its key, the later of two extensions with one key winning (a
 * development warning). An off `options` leaves the key out. The same object while the JSON is the same, so a render
 * with new handlers sends native nothing.
 */
function useHookOptions(extensions: WebViewProps['extensions']) {
  const on = (extensions ?? []).filter((extension) => !!extension);
  const keys = on.map(({ key }) => key);
  const repeated = JSON.stringify([...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))]);
  useEffect(() => {
    if (!__DEV__) return;
    for (const key of JSON.parse(repeated) as string[])
      console.warn(
        `[react-native-minimal-webview] extensions: two extensions have the key ${key}; the later one wins`
      );
  }, [repeated]);
  const json = JSON.stringify(
    withoutOff(
      Object.fromEntries(
        on.map(({ key, options = DEFAULTS.HookExtension.options }) => [key, options])
      )
    )
  );
  return useMemo(() => JSON.parse(json) as Record<string, unknown>, [json]);
}

/** Bridges by identity, for the creation key. */
const bridgeIds = new WeakMap<object, number>();
let lastBridgeId = 0;

/**
 * What native sets up once, at creation (the bridge, `ios.configuration`). As WebViewInstance's `key`, a change
 * remounts it.
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

/** A null or false value is off, and its key is left out: native treats a present key as on. */
const withoutOff = (options: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(options).filter(([, value]) => value != null && value !== false)
  );

/** A JSON.stringify replacer: the same options in another key order are the same key. */
const sortedKeys = (_: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort())
    : value;

function viewPropsOf(props: WebViewProps): ViewProps {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_SET.has(key)));
}

/** Each root's keys with its `other` ones among them, as native takes them; a generated key wins. */
const flattened = (
  roots: Record<string, { other?: NativeSettings[string] } | undefined> = {}
): NativeSettings =>
  Object.fromEntries(
    Object.entries(roots).map(([name, { other, ...keys } = {}]) => [name, { ...other, ...keys }])
  );

/** Each layer's roots over the earlier layers', key by key. */
const layered = (...layers: NativeSettings[]) =>
  layers.reduce<NativeSettings>((out, layer) => {
    for (const [root, keys] of Object.entries(layer)) out[root] = { ...out[root], ...keys };
    return out;
  }, {});

/**
 * The platform's settings for native: the package's defaults, react-native-webview's over them, the app's `ios` or
 * `android` roots over those, and `userAgent` on top. A removed `userAgent` falls back to Android's
 * `userAgentString: null` default; on iOS, native restores the removed key.
 */
function platformSettings(props: WebViewProps): NativeSettings {
  const [defaults, rnw, app, userAgent] =
    Platform.OS === 'ios'
      ? [
          flattened(DEFAULTS.IOSSettings),
          REACT_NATIVE_WEBVIEW_DEFAULTS.ios,
          flattened(props.ios),
          { webView: { customUserAgent: props.userAgent } },
        ]
      : [
          flattened(DEFAULTS.AndroidSettings),
          REACT_NATIVE_WEBVIEW_DEFAULTS.android,
          flattened(props.android),
          { settings: { userAgentString: props.userAgent } },
        ];
  return layered(defaults, rnw, app, props.userAgent === undefined ? {} : userAgent);
}

/**
 * Android's process-wide WebView functions, like the static methods of Android's `WebView`. On iOS they do nothing,
 * and `defaultUserAgent` is null.
 * @group WebView
 * @android
 * @namespace
 */
export const AndroidWebView = {
  /**
   * Android's default user agent, for `android.settings.userAgentString` with a suffix.
   *
   * The first read loads WebView's code, on the JS thread: read it once `warmUp()` has had time or a WebView is
   * mounted.
   * @android
   */
  get defaultUserAgent(): string | null {
    return Platform.OS === 'android' ? nativeModule().defaultUserAgent : null;
  },
  /**
   * Starts WebView before any WebView mounts, so the first WebView mounts sooner.
   *
   * It helps only if it runs well before the first WebView mounts: at app start, or as the screen with the WebView is
   * pushed. Calling it at mount gains nothing. WebView starts once per app, and React Native's first `fetch` starts
   * it too.
   * @android
   */
  warmUp(): void {
    if (Platform.OS === 'android') nativeModule().warmUp();
  },
  /**
   * Opens a connection to `url`'s origin (DNS, TCP, TLS) in WebView's default profile, ahead of a load that comes
   * later.
   *
   * Use it for a load that hasn't started yet: as the screen with the WebView is pushed, or for the next page a
   * mounted WebView will go to. A WebView connects to its `source` itself as it mounts, so preconnecting `source` at
   * mount gains nothing.
   *
   * It starts WebView on the UI thread if nothing has yet, so call it once `warmUp()` has had time or a WebView is
   * mounted.
   *
   * Needs the androidx.webkit features `MULTI_PROFILE` and `ENQUEUE_PRECONNECT` or `PRECONNECT`; without them it does
   * nothing. For prefetch and prerender, a native hook uses `ProfileStore`.
   * @android
   */
  preconnect(url: string): void {
    if (Platform.OS === 'android') void nativeModule().preconnect(url);
  },
  /**
   * Turns remote debugging (`chrome://inspect`) of every WebView in the app on or off.
   *
   * Until it is called, it is on when the app is debuggable (a debug build) and off otherwise. Called before any
   * WebView exists, it applies when the first one is made, so it doesn't start WebView. On iOS,
   * `ios.webView.inspectable` sets it per WebView.
   * @android
   */
  setWebContentsDebuggingEnabled(enabled: boolean): void {
    if (Platform.OS === 'android') void nativeModule().setWebContentsDebuggingEnabled(enabled);
  },
};
