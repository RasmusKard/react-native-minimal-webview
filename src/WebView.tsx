import { requireNativeModule, requireNativeView } from 'expo';
import { type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type ViewProps } from 'react-native';

import { type BridgeEvent, CONNECTION } from './bridge/createBridge';
import { codedError } from './bridge/endpoint';
import { originGuard } from './bridge/origins';
import { checkNavigationRules, defaultNavigationRules } from './navigationRules';
import { REACT_NATIVE_WEBVIEW_DEFAULTS } from './reactNativeWebViewDefaults';
import { useAttach } from './refStore';
import type {
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
type NativeHandlers<E> = { [K in keyof E]: (event: Native<E[K]>) => void };

/** The event without the `target` (the view's tag) React Native adds to every native event. */
const own = <T,>({ target: _, ...event }: T & { target?: unknown }) => event as T;

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

/** Android rejects a view function with this until Expo has registered the view. */
const notRegistered = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'ERR_VIEW_NOT_FOUND';

/** A native call nothing awaits: a rejection is logged, bar one for a view not registered yet, where it does nothing. */
const unawaited = (call: Promise<unknown> | undefined, name: string) =>
  void call?.catch((error: unknown) => {
    if (!notRegistered(error))
      console.error(`[react-native-minimal-webview] ${name} failed`, error);
  });

/**
 * A WebView whose core decides navigations and owns the navigation state: see {@link WebViewProps} and
 * {@link WebViewRef}.
 * @group WebView
 */
export function WebView(props: WebViewProps) {
  useBridgeChangeWarning(props.bridge);
  return <WebViewInstance key={creationKey(props)} {...props} />;
}

function useBridgeChangeWarning(bridge: WebViewProps['bridge']) {
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
    // Retries each frame until Expo has registered the view.
    const mounted = async (call: () => Promise<string> | undefined) => {
      for (let frame = 0; ; frame++) {
        try {
          return JSON.parse(await settled(call() ?? gone())) as unknown;
        } catch (error) {
          if (!notRegistered(error)) throw error;
          if (frame === 60 || AppState.currentState === 'background') gone();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
    };
    return {
      goBack: () => unawaited(native.current?.goBack(), 'goBack'),
      goForward: () => unawaited(native.current?.goForward(), 'goForward'),
      reload: () => unawaited(native.current?.reload(), 'reload'),
      stopLoading: () => unawaited(native.current?.stopLoading(), 'stopLoading'),
      evaluate: (script) => mounted(() => native.current?.evaluate(script)),
      get: (key) => mounted(() => native.current?.get(key)),
      call: (method, args = []) =>
        mounted(() => native.current?.call(method, JSON.stringify(args))),
      hook: (name, method, args = []) =>
        mounted(() => native.current?.hook(name, method, JSON.stringify(args))),
    };
  });
  const publish = useAttach(ref, handle);

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
    connection.attach((message) => unawaited(native.current?.bridgePost(message), 'bridgePost'));
    return () => connection.detach();
  }, [connection]);

  const requestHandlers = useRequestHandlers(props);
  const hookOptions = useHookOptions(props.extensions);
  const navigationRules = useNavigationRules(props.navigationRules);

  // One per ask in flight, by id: aborted when native stops waiting (the core's `askCancelled`) or at unmount.
  const [asks] = useState(() => new Map<number, AbortController>());
  useEffect(() => () => asks.forEach((controller) => controller.abort()), [asks]);

  const onHookEvent = async ({
    nativeEvent: { key, name, payload, askId },
  }: Native<AskableEvent>) => {
    const core = key === 'core';
    // The core's own events: a warning for the developer, and an ask native stopped waiting for.
    if (core && name === 'warning')
      return console.warn(`[react-native-minimal-webview] ${String(payload['message'])}`);
    if (core && name === 'askCancelled') return asks.get(payload['askId'] as number)?.abort();
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
      navigationRules={navigationRules}
      injectedScripts={injectedScripts}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      hookOptions={hookOptions}
      requestHandlers={requestHandlers}
      onNavigation={({ nativeEvent }) => props.onNavigation?.(own(nativeEvent))}
      onNavigationState={onNavigationState}
      onBridge={({ nativeEvent }) => connection?.receive(nativeEvent)}
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

/**
 * The rules as the core gets them (`checkNavigationRules`), and a development warning for each malformed one. The same
 * array when none is malformed.
 */
function useNavigationRules(rules: WebViewProps['navigationRules']) {
  const { checked, warnings } = useMemo(
    () => checkNavigationRules(rules ?? defaultNavigationRules),
    [rules]
  );
  useDevWarnings(warnings);
  return checked;
}

/** Logs each warning in development, again only when the list changes. */
function useDevWarnings(warnings: string[]) {
  const json = JSON.stringify(warnings);
  useEffect(() => {
    if (!__DEV__) return;
    for (const warning of JSON.parse(json) as string[])
      console.warn(`[react-native-minimal-webview] ${warning}`);
  }, [json]);
}

/** The `REQUESTS` with a prop set, as a new array only when that set changes. */
function useRequestHandlers(props: WebViewProps) {
  const key = REQUESTS.filter((prop) => props[prop]).join();
  return useMemo(() => (key ? key.split(',') : []), [key]);
}

/**
 * The core's `hookOptions`: each extension's `options` by its key, the later of two extensions with one key winning (a
 * development warning). The same object while the JSON is the same, so a render with new handlers sends the core
 * nothing.
 */
function useHookOptions(extensions: WebViewProps['extensions']) {
  const on = (extensions ?? []).filter((extension) => !!extension);
  const keys = on.map(({ key }) => key);
  useDevWarnings(
    [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))].map(
      (key) => `extensions: two extensions have the key ${key}; the later one wins`
    )
  );
  const json = JSON.stringify(
    withoutOff(
      Object.fromEntries(
        // An unset `options` is `true` (HookExtension.options).
        on.map(({ key, options = true }) => [key, options])
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
 * `android` roots over those, and `userAgent` on top. Native restores the key of a removed `userAgent`. Android's
 * own defaults are written natively.
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
          {},
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
   * pushed. WebView starts once per app, and React Native's first `fetch` starts it too.
   * @android
   */
  warmUp(): void {
    if (Platform.OS === 'android') nativeModule().warmUp();
  },
  /**
   * Opens a connection to `url`'s origin (DNS, TCP, TLS) in WebView's default profile, ahead of a load.
   *
   * Call it before the load starts: as the screen with the WebView is pushed, or for the next page a mounted WebView
   * will go to. A WebView connects to its `source` itself as it mounts.
   *
   * It starts WebView on the UI thread if nothing has yet, so call it once `warmUp()` has had time or a WebView is
   * mounted.
   *
   * Needs the androidx.webkit features `MULTI_PROFILE` and `ENQUEUE_PRECONNECT` or `PRECONNECT`; without them it does
   * nothing. For prefetch and prerender, a native hook uses `ProfileStore`.
   * @android
   */
  preconnect(url: string): void {
    if (Platform.OS === 'android') unawaited(nativeModule().preconnect(url), 'preconnect');
  },
  /**
   * Turns remote debugging (`chrome://inspect`) of every WebView in the app on or off.
   *
   * Until it is called, it is on when the app is debuggable (a debug build) and off otherwise. Called before any
   * WebView exists, it applies when the first one is made, so it doesn't start WebView. On iOS,
   * `ios.webView.inspectable` sets it per WebView.
   * @android
   * @see [Debugging the page example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#debugging-the-page)
   */
  setWebContentsDebuggingEnabled(enabled: boolean): void {
    if (Platform.OS === 'android')
      unawaited(
        nativeModule().setWebContentsDebuggingEnabled(enabled),
        'setWebContentsDebuggingEnabled'
      );
  },
};
