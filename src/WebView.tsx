import { requireNativeModule, requireNativeView } from 'expo';
import { type Ref, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type ViewProps } from 'react-native';

import { CONNECTION } from './bridge/createBridge';
import { codedError, invalidOrigins, originForms } from './bridge/endpoint';
import { MATCHES_ORIGIN } from './bridge/pageClient.generated';
import { defaultNavigationRules } from './defaultNavigationRules';
import { type Attachment, INITIAL_STATE, useAttach } from './refStore';
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
const ERROR_KEYS = keysOf<Exclude<LoadErrorEvent, { kind: 'http' }>>({
  kind: true,
  url: true,
  code: true,
  description: true,
});
const HTTP_ERROR_KEYS = keysOf<Extract<LoadErrorEvent, { kind: 'http' }>>({
  kind: true,
  url: true,
  statusCode: true,
});
const PROCESS_GONE_KEYS = keysOf<ProcessGoneEvent>({ didCrash: true, recovered: true });

/** A page's message comes with its origin, as native verified it (`location.origin` form). */
export type BridgeEvent =
  { message: string; origin: string } | { navigated: true } | { unavailable: true };

/** A hook's event as native sends it: `name` is `'<key>.<event name>'`. `askId` is set when native waits for the answer. */
export type AskableEvent = { name: string; payload: Record<string, unknown>; askId?: number };

/**
 * Page requests the core answers natively, by native event name (`core.` plus the key). Native asks JS only for those
 * whose prop is set, and reads the set when the request comes, so a prop can come and go.
 */
const REQUESTS = {
  navigationRequest: 'onNavigationRequest',
  openExternal: 'onOpenExternal',
  fileRequest: 'onFileRequest',
  fullscreenChange: 'onFullscreenChange',
  permissionRequest: 'onPermissionRequest',
  download: 'onDownload',
} as const;
/** The core's own events; everything else is a hook's, for its extension's `onEvent`. */
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
  'extensions',
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
  /** Answers a native `ask`. The value is wrapped: native arguments can't be of any type. */
  answer(askId: number, answer: { value: unknown }): Promise<void>;
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

/** Runs a JS handler that native waits on: one that throws still answers, with null (native's safe default). */
const settle = <T,>(handler: () => T | Promise<T>, failure: string) =>
  Promise.resolve()
    .then(handler)
    .catch((error: unknown) => {
      console.error(`[react-native-minimal-webview] ${failure}`, error);
      return null;
    });

/**
 * A WebView whose native side decides navigations and owns the navigation state: see {@link WebViewProps} and
 * {@link WebViewRef}.
 * @group WebView
 */
export function WebView(props: WebViewProps) {
  return <WebViewInstance key={creationKey(props)} {...props} />;
}

/** One native WebView's life: a new creation key remounts it, so its state, ref attachment and bridge start over. */
function WebViewInstance({ ref, ...props }: WebViewProps) {
  const native = useRef<NativeMethods>(null);
  const attachmentRef = useRef<Attachment>(undefined);
  const { onNavigationState, onError, lastRef } = useLoadEvents(props, attachmentRef);

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
  useAttach(ref, handle, lastRef, attachmentRef);

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
      : (_: unknown, signal?: AbortSignal) => {
          const owner = ownerOf(props.extensions, name);
          return owner?.onEvent?.({ name: name.slice(owner.key.length + 1), payload }, signal);
        };
    // Only an ask can be cancelled, so only an ask gets a signal.
    let controller: AbortController | undefined;
    if (askId !== undefined) {
      controller = new AbortController();
      asks.set(askId, controller);
    }
    const value = await settle(
      () => handler?.(payload, controller?.signal),
      request ? `${request} failed` : `onEvent failed for ${name}`
    );
    if (askId === undefined) return;
    asks.delete(askId);
    // Native already answered a cancelled ask with null; a late answer would find nothing.
    if (!controller?.signal.aborted) await native.current?.answer(askId, { value: value ?? null });
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
      onNavigation={({ nativeEvent }) => props.onNavigation?.(pick(nativeEvent, NAVIGATION_KEYS))}
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

/**
 * The scripts as native runs them: one whose `origins` lack `*` runs inside a function, so that even its function
 * declarations take effect only where the guard lets it run.
 */
function nativeScripts(scripts: InjectedScript[] | undefined) {
  return scripts?.map(({ code, allFrames, origins }) => {
    if (!Array.isArray(origins))
      throw new Error("injectedScripts: every script needs origins (['*'] for every origin)");
    const invalid = invalidOrigins(origins);
    if (invalid.length) {
      throw new Error(
        `injectedScripts: invalid origins ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
      );
    }
    const forms = originForms(origins);
    if (forms.any) return { code, allFrames };
    const guard = `(${MATCHES_ORIGIN})(${JSON.stringify(forms)}, location.origin)`;
    return { code: `if (${guard}) (() => {\n${code}\n})();`, allFrames };
  });
}

/** The page requests with a prop set, as a new array only when that set changes. */
function useRequestHandlers(props: WebViewProps) {
  const key = Object.entries(REQUESTS)
    .filter(([, prop]) => props[prop])
    .map(([event]) => event)
    .join();
  return useMemo(() => (key ? key.split(',') : []), [key]);
}

/**
 * Native's `hookOptions`: each extension's `options` (`true` when unset) by its key, the later of two extensions with
 * one key winning (a development warning). A null `options` leaves the key out. The same object while the JSON is the
 * same, so a render with new handlers sends native nothing.
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
    withoutNulls(Object.fromEntries(on.map(({ key, options = true }) => [key, options])))
  );
  return useMemo(() => JSON.parse(json) as Record<string, unknown>, [json]);
}

/** The extension whose key is the longest prefix of the event's `name` (`'<key>.'`); the later of equal keys. */
function ownerOf(extensions: WebViewProps['extensions'], name: string) {
  let owner: HookExtension | undefined;
  for (const extension of extensions ?? []) {
    if (!extension || !name.startsWith(`${extension.key}.`)) continue;
    if (!owner || extension.key.length >= owner.key.length) owner = extension;
  }
  return owner;
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

/** A null value is no value: the hook is off, and for an attached one the key is removed. */
const withoutNulls = (options: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => value != null));

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

/**
 * The platform's settings for native: the package's defaults, the app's `ios` or `android` roots over them, and
 * `userAgent` on top. An unset `userAgent` resets its key to the default, so removing the prop undoes it.
 */
function platformSettings(props: WebViewProps): NativeSettings {
  const set = (value: string | undefined, key: string) =>
    value === undefined ? {} : { [key]: value };
  if (Platform.OS === 'ios') {
    const { configuration, webView, ...rest } = flattened(props.ios);
    const defaults = flattened(DEFAULTS.IOSSettings);
    return {
      ...rest,
      configuration: { ...defaults.configuration, ...configuration },
      webView: {
        ...defaults.webView,
        ...webView,
        ...set(props.userAgent, 'customUserAgent'),
      },
    };
  }
  const { settings, webView } = flattened(props.android);
  return {
    settings: {
      ...flattened(DEFAULTS.AndroidSettings).settings,
      ...settings,
      ...set(props.userAgent, 'userAgentString'),
    },
    webView: { ...webView },
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

  const onError = ({ nativeEvent }: Native<LoadErrorEvent>) =>
    props.onError?.(
      nativeEvent.kind === 'http'
        ? pick(nativeEvent, HTTP_ERROR_KEYS)
        : pick(nativeEvent, ERROR_KEYS)
    );

  return { onNavigationState, onError, lastRef };
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
