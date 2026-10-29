import { requireNativeModule, requireNativeView } from 'expo';
import { type Ref, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type ViewProps } from 'react-native';

import { CONNECTION } from './bridge/createBridge';
import { codedError } from './bridge/endpoint';
import { DEFAULTS } from './defaults.generated';
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

/** The native view's methods, on its ref. */
export type NativeMethods = {
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
    const parsed = (json: string) => JSON.parse(json) as unknown;
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
    // Android can run a view function before Expo has registered the view and reject it with ERR_VIEW_NOT_FOUND:
    // try again each frame for about a second. An unmount ends the loop, as `call` then finds no view; so does the
    // background, where no frame comes.
    const mounted = async (call: () => Promise<string> | undefined) => {
      for (let frame = 0; ; frame++) {
        try {
          return parsed(await settled(call() ?? gone()));
        } catch (error) {
          if ((error as { code?: string }).code !== 'ERR_VIEW_NOT_FOUND') throw error;
          if (frame === 60 || AppState.currentState === 'background') gone();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
    };
    return {
      goBack: () => void native.current?.navigate('back'),
      goForward: () => void native.current?.navigate('forward'),
      reload: () => void native.current?.navigate('reload'),
      stopLoading: () => void native.current?.navigate('stop'),
      evaluate: (script) => mounted(() => native.current?.evaluate(script)),
      get: (key) => mounted(() => native.current?.get(key)),
      call: (method, args = [], options) =>
        mounted(() =>
          native.current?.call(method, JSON.stringify(args), options?.completion ?? null)
        ),
      hook: (name, method, args = []) =>
        mounted(() => native.current?.hook(name, method, JSON.stringify(args))),
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
      () => handler?.(request === 'onOpenExternal' ? payload['url'] : payload, controller?.signal),
      // Native counts a missing answer as `block` too.
      request === 'onNavigationRequest' ? 'block' : null,
      request ? `${request} failed` : `onHookEvent failed for ${name}`
    );
    if (askId === undefined) return;
    asks.delete(askId);
    // Native already answered a cancelled ask with null; a late answer would find nothing.
    if (!controller?.signal.aborted) await answer(askId, value);
  };

  return (
    <NativeWebView
      {...viewPropsOf(props)}
      ref={native}
      source={props.source}
      settings={settings}
      pullToRefresh={props.pullToRefresh}
      sharedCookies={Platform.OS === 'ios' ? props.sharedCookies : undefined}
      navigationRules={props.navigationRules}
      injectedScripts={props.injectedScripts}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      hookOptions={props.hookOptions && withoutNulls(props.hookOptions)}
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
    return {
      ...rest,
      configuration: { ...DEFAULTS.IOSSettings.configuration, ...configuration },
      webView: {
        ...DEFAULTS.IOSSettings.webView,
        ...webView,
        ...set(props.userAgent, 'customUserAgent'),
      },
    };
  }
  const { settings, webView } = flattened(props.android);
  return {
    settings: {
      ...DEFAULTS.AndroidSettings.settings,
      ...settings,
      ...set(props.userAgent, 'userAgentString'),
    },
    webView: { ...DEFAULTS.AndroidSettings.webView, ...webView },
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

/**
 * What `WebView` carries besides the component: `preconnect`, `warmUp` and `defaultUserAgent`.
 * @group WebView
 * @hideGroups
 */
export declare namespace WebView {
  /**
   * Android's default user agent, for `android.settings.userAgentString` with a suffix.
   *
   * Null on iOS, where `ios.configuration.applicationNameForUserAgent` appends.
   * @android
   */
  const defaultUserAgent: string | null;
  /**
   * Starts WebView (loads its code, starts Chromium) before any WebView mounts, on a background thread where the
   * device's WebView supports that, so the first WebView mounts sooner.
   *
   * It helps only if it runs well before the first WebView mounts: at app start, or as the screen with the WebView is
   * pushed. A mounting WebView starts WebView itself, on the UI thread, so calling this at mount gains nothing. WebView
   * starts once per app, and React Native's first `fetch` starts it too (its cookie jar is WebView's `CookieManager`).
   * No-op on iOS.
   * @android
   */
  function warmUp(): void;
  /**
   * Opens a connection to `url`'s origin (DNS, TCP, TLS) in WebView's default profile, ahead of a load that comes later.
   *
   * Use it for a load that hasn't started yet: as the screen with the WebView is pushed, or for the next page a mounted
   * WebView will go to. A WebView connects to its `source` itself as it mounts, so preconnecting `source` at mount
   * gains nothing. It starts WebView on the UI thread if nothing has yet, so call it once `warmUp()` has had time or a
   * WebView is mounted. Does nothing on a WebView without `Profile.enqueuePreconnect` or `Profile.preconnect`, and on
   * iOS. For prefetch and prerender, a native hook uses `ProfileStore`.
   * @android
   */
  function preconnect(url: string): void;
}
Object.defineProperty(WebView, 'defaultUserAgent', {
  get: (): string | null => (Platform.OS === 'android' ? nativeModule().defaultUserAgent : null),
});
Object.assign(WebView, {
  warmUp: (): void => {
    if (Platform.OS === 'android') nativeModule().warmUp();
  },
  preconnect: (url: string): void => {
    if (Platform.OS === 'android') void nativeModule().preconnect(url);
  },
});
