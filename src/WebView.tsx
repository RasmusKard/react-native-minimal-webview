import { requireNativeModule, requireNativeView, requireOptionalNativeModule } from 'expo';
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
  NavigationState,
  ProcessGoneEvent,
  SettingValue,
  WebViewProps,
  WebViewRef,
} from './types';
import { DEFAULTS } from './types.defaults';

type Native<T> = { nativeEvent: T };
type NativeHandlers<E> = { [K in keyof E]: (event: Native<E[K]>) => void };

// React Native adds `target`, the view's tag, to every native event.
const withoutTarget = <T,>({ target: _, ...event }: T & { target?: unknown }) => event as T;

export type AskableEvent = {
  key: string;
  name: string;
  payload: Record<string, unknown>;
  askId?: number;
};

export type CoreEventPayloads = { warning: { message: string }; askCancelled: { askId: number } };

const REQUEST_HANDLER_PROPS = [
  'onNavigationRequest',
  'onOpenExternal',
  'onFileRequest',
  'onFullscreenChange',
  'onPermissionRequest',
  'onDownload',
  'onNavigation',
] as const;

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
  ...REQUEST_HANDLER_PROPS,
  'ref',
  'children',
] as const satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[];
type Unlisted = Exclude<Exclude<keyof WebViewProps, keyof ViewProps>, (typeof OWN)[number]>;
const OWN_SET: Set<string> &
  ([Unlisted] extends [never] ? unknown : Record<Unlisted, 'missing from OWN'>) = new Set(OWN);

type NativeSettings = Record<string, Record<string, SettingValue | undefined>>;

type NativeProps = ViewProps &
  Pick<WebViewProps, 'source' | 'navigationRules' | 'pullToRefresh'> & {
    injectedScripts: Omit<InjectedScript, 'origins'>[] | undefined;
    ref: Ref<NativeMethods>;
    sharedCookies: boolean | undefined;
    // The native dictionary conversion drops a `null`.
    settings: string;
    bridgeScript: string | undefined;
    bridgeOrigins: string[] | undefined;
    hookOptions: Record<string, unknown> | undefined;
    requestHandlers: string[];
  } & NativeHandlers<{
    onNavigationState: NavigationState;
    onBridge: BridgeEvent;
    onHookEvent: AskableEvent;
    onError: LoadErrorEvent;
    onProcessGone: ProcessGoneEvent;
  }>;

export type NativeMethods = {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  load(url: string): Promise<void>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
  bridgePost(message: string): Promise<void>;
  answer(askId: number, json: string): Promise<void>;
  evaluate(script: string): Promise<string>;
  get(path: string): Promise<string>;
  // The native conversion drops a `null` argument.
  call(path: string, argsJson: string): Promise<string>;
  hook(name: string, method: string, argsJson: string): Promise<string>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');
const nativeModule = () =>
  requireNativeModule<{
    defaultUserAgent: string;
    warmUp(): void;
    preconnect(url: string): Promise<void>;
    setWebContentsDebuggingEnabled(enabled: boolean): Promise<void>;
  }>('MinimalWebView');

let linked = false;
// pod install leaves the pod out below the iOS floor with only a warning, which `expo run:ios` hides; without this the
// view renders as React Native's "Unimplemented component".
function assertLinked() {
  linked ||= requireOptionalNativeModule('MinimalWebView') != null;
  if (!linked)
    throw new Error(
      '[react-native-minimal-webview] this build has no MinimalWebView native module. On iOS, pod install leaves ' +
        'it out below the deployment target 17.0: set it to 17.0 or later, then rebuild. Otherwise, rebuild the app.'
    );
}

/** Android rejects a view function with this until Expo has registered the view. */
const notRegistered = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'ERR_VIEW_NOT_FOUND';

const unawaited = (call: Promise<unknown> | undefined, name: string) =>
  void call?.catch((error: unknown) => {
    if (!notRegistered(error))
      console.error(`[react-native-minimal-webview] ${name} failed`, error);
  });

// A URL parser skips leading controls and spaces and drops tabs and newlines. Android's loadUrl runs a `javascript:`
// URL's script.
const isJavaScriptUrl = (url: string) => /^[\0- ]*javascript:/i.test(url.replace(/[\t\n\r]/g, ''));

/**
 * A WebView whose core decides each navigation and owns the navigation state. Its props are {@link WebViewProps}, and
 * its ref is a {@link WebViewRef}.
 * @throws An `Error` as it renders when the app was built without the package's native module, as on iOS below the
 * deployment target 17.0.
 * @group WebView
 */
export function WebView(props: WebViewProps) {
  assertLinked();
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

function WebViewInstance({ ref, ...props }: WebViewProps) {
  const native = useRef<NativeMethods>(null);

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
    const settled = <T,>(promise: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        inFlight.add(reject);
        promise.finally(() => inFlight.delete(reject)).then(resolve, reject);
      });
    const retriedUntilViewRegistered = async <T,>(call: () => Promise<T> | undefined) => {
      for (let frame = 0; ; frame++) {
        try {
          return await settled(call() ?? gone());
        } catch (error) {
          if (!notRegistered(error)) throw error;
          if (frame === 60 || AppState.currentState === 'background') gone();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
    };
    const jsonResultOf = async (call: () => Promise<string> | undefined) =>
      JSON.parse(await retriedUntilViewRegistered(call)) as unknown;
    return {
      goBack: () => unawaited(native.current?.goBack(), 'goBack'),
      goForward: () => unawaited(native.current?.goForward(), 'goForward'),
      load: (url) => {
        if (isJavaScriptUrl(url)) {
          if (__DEV__)
            console.warn(
              '[react-native-minimal-webview] load: a javascript: URL loads nothing; run a script with evaluate'
            );
          return;
        }
        unawaited(
          retriedUntilViewRegistered(() => native.current?.load(url)).catch((error: unknown) => {
            const code = (error as { code?: string } | null)?.code;
            if (code !== 'unavailable' && code !== 'navigated') throw error;
          }),
          'load'
        );
      },
      reload: () => unawaited(native.current?.reload(), 'reload'),
      stopLoading: () => unawaited(native.current?.stopLoading(), 'stopLoading'),
      evaluate: (script) => jsonResultOf(() => native.current?.evaluate(script)),
      get: (key) => jsonResultOf(() => native.current?.get(key)),
      call: (method, args = []) =>
        jsonResultOf(() => native.current?.call(method, JSON.stringify(args))),
      hook: (name, method, args = []) =>
        jsonResultOf(() => native.current?.hook(name, method, JSON.stringify(args))),
    };
  });
  const publish = useAttach(ref, handle);

  const onNavigationState = ({ nativeEvent }: Native<NavigationState>) => {
    const state = withoutTarget(nativeEvent);
    const was = publish(state);
    props.onNavigationStateChange?.(state);
    if (!was.loading && state.loading) props.onLoadStart?.(state);
    if (was.loading && !state.loading) props.onLoadEnd?.(state);
  };

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

  const [asks] = useState(() => new Map<number, AbortController>());
  useEffect(() => () => asks.forEach((controller) => controller.abort()), [asks]);

  const onHookEvent = async ({
    nativeEvent: { key, name, payload, askId },
  }: Native<AskableEvent>) => {
    const core = key === 'core';
    if (core && name === 'warning')
      return console.warn(
        `[react-native-minimal-webview] ${(payload as CoreEventPayloads['warning']).message}`
      );
    if (core && name === 'askCancelled')
      return asks.get((payload as CoreEventPayloads['askCancelled']).askId)?.abort();
    const request = REQUEST_HANDLER_PROPS.find((prop) => core && prop === name);
    const owner = props.extensions?.findLast((e): e is HookExtension => !!e && e.key === key);
    const handler = request
      ? (props[request] as ((payload: unknown, signal?: AbortSignal) => unknown) | undefined)
      : (_: unknown, signal?: AbortSignal) =>
          signal && owner?.onAsk
            ? owner.onAsk({ name, payload }, signal)
            : owner?.onEvent?.({ name, payload }, signal);
    let controller: AbortController | undefined;
    if (askId !== undefined) {
      controller = new AbortController();
      asks.set(askId, controller);
    }
    const failure = request
      ? `${request} failed`
      : `${hookHandlerName(owner, askId)} failed for ${key}.${name}`;
    let value: unknown = null;
    try {
      value = await handler?.(payload, controller?.signal);
    } catch (error) {
      console.error(`[react-native-minimal-webview] ${failure}`, error);
    }
    if (askId === undefined) return;
    asks.delete(askId);
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
      onNavigationState={onNavigationState}
      onBridge={({ nativeEvent }) => connection?.receive(nativeEvent)}
      onHookEvent={onHookEvent}
      onError={({ nativeEvent }) => props.onError?.(withoutTarget(nativeEvent))}
      onProcessGone={({ nativeEvent }) => props.onProcessGone?.(withoutTarget(nativeEvent))}
    />
  );
}

const hookHandlerName = (owner: HookExtension | undefined, askId: number | undefined) =>
  askId !== undefined && owner?.onAsk ? 'onAsk' : 'onEvent';

function answerJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

function nativeScripts(scripts: InjectedScript[] | undefined) {
  return scripts?.map(({ code, allFrames, origins }) => {
    if (!Array.isArray(origins))
      throw new Error("injectedScripts: every script needs origins (['*'] for every origin)");
    const guard = originGuard('injectedScripts: invalid origins', origins);
    return { code: guard ? `if (${guard}) (() => {\n${code}\n})();` : code, allFrames };
  });
}

function useNavigationRules(rules: WebViewProps['navigationRules']) {
  const { checked, warnings } = useMemo(
    () => checkNavigationRules(rules ?? defaultNavigationRules),
    [rules]
  );
  useDevWarnings(warnings);
  return checked;
}

function useJsonStable<T>(value: T): T {
  const json = JSON.stringify(value);
  return useMemo(() => JSON.parse(json) as T, [json]);
}

function useDevWarnings(warnings: string[]) {
  const stable = useJsonStable(warnings);
  useEffect(() => {
    if (!__DEV__) return;
    for (const warning of stable) console.warn(`[react-native-minimal-webview] ${warning}`);
  }, [stable]);
}

function useRequestHandlers(props: WebViewProps): string[] {
  return useJsonStable(REQUEST_HANDLER_PROPS.filter((prop) => props[prop]));
}

function useHookOptions(extensions: WebViewProps['extensions']) {
  const on = (extensions ?? []).filter((extension) => !!extension);
  const keys = on.map(({ key }) => key);
  useDevWarnings(
    [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))].map(
      (key) => `extensions: two extensions have the key ${key}; the later one wins`
    )
  );
  return useJsonStable<Record<string, unknown>>(
    withoutOff(Object.fromEntries(on.map(({ key, options = true }) => [key, options])))
  );
}

const bridgeIds = new WeakMap<object, number>();
let lastBridgeId = 0;

function creationKey(props: WebViewProps) {
  const bridge = props.bridge;
  let id = bridge && bridgeIds.get(bridge);
  if (bridge && id === undefined) bridgeIds.set(bridge, (id = ++lastBridgeId));
  return JSON.stringify(
    [id ?? 0, Platform.OS === 'ios' ? props.ios?.configuration : undefined],
    sortedKeys
  );
}

const withoutOff = (options: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(options).filter(([, value]) => value != null && value !== false)
  );

const sortedKeys = (_: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort())
    : value;

function viewPropsOf(props: WebViewProps): ViewProps {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_SET.has(key)));
}

const flattened = (
  roots: Record<string, { other?: NativeSettings[string] } | undefined> = {}
): NativeSettings =>
  Object.fromEntries(
    Object.entries(roots).map(([name, { other, ...keys } = {}]) => [name, { ...other, ...keys }])
  );

const layered = (...layers: NativeSettings[]) =>
  layers.reduce<NativeSettings>((out, layer) => {
    for (const [root, keys] of Object.entries(layer)) out[root] = { ...out[root], ...keys };
    return out;
  }, {});

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
 * Android's process-wide WebView functions. On iOS they do nothing, and `defaultUserAgent` is null.
 * @group WebView
 * @android
 * @namespace
 */
export const AndroidWebView = {
  /**
   * Android's default user agent. Add a suffix to it to set `android.settings.userAgentString`.
   *
   * The first read loads Android System WebView on the JS thread. Read it after `warmUp()` has had time to run, or once
   * a WebView is mounted. It is null while Android System WebView is missing, disabled or updating, and a later read
   * tries again.
   * @android
   */
  get defaultUserAgent(): string | null {
    if (Platform.OS !== 'android') return null;
    try {
      return nativeModule().defaultUserAgent;
    } catch {
      // Expo caches a value the native getter returns, a null too, but not a throw.
      return null;
    }
  },
  /**
   * Starts Android System WebView before any WebView mounts, so that the first WebView mounts sooner.
   *
   * It helps only when it runs well before the first WebView mounts, such as at app start or as the screen with the
   * WebView is pushed. Android System WebView starts once per app.
   * @android
   */
  warmUp(): void {
    if (Platform.OS === 'android') nativeModule().warmUp();
  },
  /**
   * Opens a connection to `url`'s origin in the default profile, ahead of a load.
   *
   * Call it before the load starts, such as when the screen with the WebView is pushed, or for the next page a mounted
   * WebView will go to.
   *
   * It starts Android System WebView on the UI thread if nothing has yet. Call it after `warmUp()` has had time to run,
   * or once a WebView is mounted.
   *
   * It does nothing without the androidx.webkit features `MULTI_PROFILE` and `ENQUEUE_PRECONNECT` or `PRECONNECT`.
   * @android
   */
  preconnect(url: string): void {
    if (Platform.OS === 'android') unawaited(nativeModule().preconnect(url), 'preconnect');
  },
  /**
   * Turns remote debugging (`chrome://inspect`) of every WebView in the app on or off.
   *
   * Until it is called, remote debugging is on when the app is debuggable, as a debug build is, and off otherwise.
   * Called before any WebView exists, it applies when the first one is made and doesn't start Android System WebView.
   * On iOS, `ios.webView.inspectable` sets it per WebView.
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
