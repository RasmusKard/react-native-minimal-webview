import { requireNativeModule, requireNativeView } from 'expo';
import {
  type ReactElement,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { type BridgeConnection, CONNECTION } from './bridge/createBridge';
import type {
  AndroidWebViewInfo,
  Bridge,
  NavigationEvent,
  NavigationRequest,
  NavigationState,
  ProcessGoneEvent,
  WebViewErrorEvent,
  WebViewExtension,
  WebViewProps,
  WebViewRef,
} from './types';

type NativeEvent<T> = { nativeEvent: T };

type BridgeEvent = { message?: string; unavailable?: boolean; navigated?: boolean };

/** `askId` is set when native waits for the answer (ExtensionHost.ask). */
type ExtensionEvent = {
  name: string;
  event: string;
  payload: Record<string, unknown>;
  askId?: number;
};

/** Props that pass straight through to the native view. */
const PASSTHROUGH = [
  'navigationRules',
  'userAgent',
  'applicationNameForUserAgent',
  'thirdPartyCookies',
  'mediaPlaybackRequiresUserAction',
  'allowsInlineMediaPlayback',
  'scrollEnabled',
  'bounces',
  'showsScrollIndicators',
  'javaScriptCanOpenWindowsAutomatically',
] as const;
type Passthrough = Pick<WebViewProps, (typeof PASSTHROUGH)[number]>;

/** Every prop that is not a `ViewProps` one, so it never reaches the outermost view. Add new props here. */
const OWN = new Set<string>([
  ...PASSTHROUGH,
  ...([
    'source', 'injectedScripts', 'webviewDebuggingEnabled', 'bridge', 'extensions', 'renderLoading', 'renderError',
    'onNavigationRequest', 'onOpenExternal', 'onNavigation', 'onNavigationStateChange', 'onError', 'onProcessGone',
    'onLoadStart', 'onLoad', 'onLoadEnd', 'children',
  ] satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[]),
]);

type NativeProps = ViewProps &
  Passthrough &
  Pick<WebViewProps, 'source' | 'injectedScripts' | 'webviewDebuggingEnabled'> & {
    ref: Ref<NativeMethods>;
    bridgeScript: string | undefined;
    bridgeOrigins: string[] | undefined;
    extensions: WebViewExtension['native'][] | undefined;
    openExternalInJS: boolean;
    onNavigation: (event: NativeEvent<NavigationEvent>) => void;
    onNavigationState: (event: NativeEvent<NavigationState>) => void;
    onNavigationRequest: (event: NativeEvent<NavigationRequest & { id: number }>) => void;
    onBridge: (event: NativeEvent<BridgeEvent>) => void;
    onExtension: (event: NativeEvent<ExtensionEvent>) => void;
    onError: (event: NativeEvent<WebViewErrorEvent>) => void;
    onProcessGone: (event: NativeEvent<ProcessGoneEvent>) => void;
  };

type NativeMethods = Record<
  'goBack' | 'goForward' | 'reload' | 'stopLoading',
  () => Promise<void>
> & {
  bridgePost(message: string): Promise<void>;
  /** Answers a native `ask` (navigation or extension). The value is wrapped: native arguments can't be of any type. */
  answer(askId: number, answer: { value: unknown }): Promise<void>;
  /** The JSON-encoded result, or null. */
  evaluate(script: string): Promise<string | null>;
  getUrl(): Promise<string | null>;
};

const NativeWebView = requireNativeView<NativeProps>('MinimalWebView');

const INITIAL_STATE: NavigationState = {
  url: '',
  pendingUrl: null,
  title: '',
  loading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
};

const STORE = Symbol('navigationStateStore');

type Store = ReturnType<typeof createStore>;

type InternalRef = WebViewRef & { [STORE]: Store };

function createStore() {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: NavigationState) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Runs a JS handler that native waits on: one that throws still answers, with the safe default. */
const settle = <T,>(handler: () => T | Promise<T>, fallback: T, failure: string) =>
  Promise.resolve()
    .then(handler)
    .catch((error: unknown) => {
      console.error(`[react-native-minimal-webview] ${failure}`, error);
      return fallback;
    });

const NEEDS = {
  bridge: {
    features: ['WEB_MESSAGE_LISTENER', 'JS_INJECTION_IN_FRAME_AND_WORLD'],
    lost: 'bridge calls reject with `unavailable`',
  },
  injectedScripts: {
    features: ['JS_INJECTION_IN_FRAME_AND_WORLD'],
    lost: "injectedScripts don't run",
  },
};
// Read once: a WebView update restarts the app process.
let info: AndroidWebViewInfo | null | undefined;
const warned = new Set<string>();

/** Android: warns once per process for each used prop whose WebView features the device lacks. */
export function warnUnsupported(used: Record<keyof typeof NEEDS, boolean>) {
  if (Platform.OS !== 'android') return;
  for (const [prop, { features, lost }] of Object.entries(NEEDS)) {
    if (!used[prop as keyof typeof NEEDS] || warned.has(prop)) continue;
    if (info === undefined) {
      try {
        info = WebView.getAndroidWebViewInfo();
      } catch {
        info = null;
      }
    }
    const device = info;
    const missing = features.filter((feature) => device && !device.features[feature]);
    if (!device || !missing.length) continue;
    warned.add(prop);
    console.warn(
      `[react-native-minimal-webview] ${prop} needs WebView features ${missing.join(', ')}, missing in ${device.provider} ${device.version}: ${lost}. Update Android System WebView to 146+.`
    );
  }
}

export function WebView({ ref, ...props }: WebViewProps & { ref?: Ref<WebViewRef> }) {
  const native = useRef<NativeMethods>(null);
  const store = useRef(createStore()).current;
  const { error, loading, onNavigationState, onError } = useLoadEvents(props, store);

  useImperativeHandle(ref, (): InternalRef => {
    // Methods called before the native view exists are no-ops, like a browser tab that is still opening.
    return {
      goBack: () => void native.current?.goBack(),
      goForward: () => void native.current?.goForward(),
      reload: () => void native.current?.reload(),
      stopLoading: () => void native.current?.stopLoading(),
      evaluate: async (script) => {
        const json = await native.current?.evaluate(script);
        return json ? (JSON.parse(json) as unknown) : undefined;
      },
      getUrl: async () => (await native.current?.getUrl()) ?? '',
      [STORE]: store,
    };
  }, [store]);

  const connection =
    props.bridge && (props.bridge as Bridge & { [CONNECTION]: BridgeConnection })[CONNECTION];
  useEffect(() => {
    if (!connection) return undefined;
    connection.attach((message) => void native.current?.bridgePost(message));
    return () => connection.detach();
  }, [connection]);

  const hasScripts = !!props.injectedScripts?.length;
  useEffect(
    () => warnUnsupported({ bridge: !!connection, injectedScripts: hasScripts }),
    [connection, hasScripts]
  );

  const onBridge = ({ nativeEvent }: NativeEvent<BridgeEvent>) => {
    if (nativeEvent.message !== undefined) connection?.receive(nativeEvent.message);
    else if (nativeEvent.navigated) connection?.navigated();
    else connection?.markUnavailable();
  };

  const answer = (askId: number, value: unknown) => native.current?.answer(askId, { value: value ?? null });

  const onExtension = async ({
    nativeEvent: { name, event, payload, askId },
  }: NativeEvent<ExtensionEvent>) => {
    const extension = props.extensions?.find((candidate) => candidate.native.name === name);
    const value = await settle(
      () => extension?.onEvent?.(event, payload),
      null,
      `the ${name} extension's ${event} handler failed`
    );
    if (askId !== undefined) await answer(askId, value);
  };

  const onNavigation = ({ nativeEvent }: NativeEvent<NavigationEvent>) => {
    if (nativeEvent.action === 'external') props.onOpenExternal?.(nativeEvent.url);
    props.onNavigation?.(nativeEvent);
  };

  // Native blocks unanswered requests after 1 s and ignores late answers.
  const onNavigationRequest = async ({
    nativeEvent: { id, ...request },
  }: NativeEvent<NavigationRequest & { id: number }>) => {
    const action = await settle(
      () => props.onNavigationRequest?.(request),
      'block',
      'onNavigationRequest failed; blocking'
    );
    await answer(id, action ?? 'block');
  };

  const webView = (
    <NativeWebView
      {...(props.renderLoading || props.renderError ? {} : viewPropsOf(props))}
      ref={native}
      source={props.source}
      style={props.renderLoading || props.renderError ? styles.fill : props.style}
      {...settingsOf(props)}
      bridgeScript={connection?.script}
      bridgeOrigins={connection?.allowedOrigins}
      extensions={props.extensions?.map((extension) => extension.native)}
      openExternalInJS={props.onOpenExternal !== undefined}
      onNavigation={onNavigation}
      onNavigationState={onNavigationState}
      onNavigationRequest={onNavigationRequest}
      onBridge={onBridge}
      onExtension={onExtension}
      onError={onError}
      onProcessGone={({ nativeEvent }) => props.onProcessGone?.(nativeEvent)}
    />
  );
  return withOverlay(webView, props, error, loading);
}

/** `style`, `testID`, the accessibility props and the other ViewProps, for the outermost view. */
function viewPropsOf(props: WebViewProps): ViewProps {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN.has(key)));
}

/** Native props that pass straight through. */
function settingsOf(props: WebViewProps) {
  return {
    ...(Object.fromEntries(PASSTHROUGH.map((key) => [key, props[key]])) as Passthrough),
    injectedScripts: props.injectedScripts,
    webviewDebuggingEnabled: props.webviewDebuggingEnabled ?? __DEV__,
  };
}

/**
 * Load events and the overlay state. The current load's main-frame error: onLoad fires only without one, and
 * renderError shows it until the next load starts.
 */
function useLoadEvents(props: WebViewProps, store: Store) {
  const [error, setError] = useState<WebViewErrorEvent | null>(null);
  const errorRef = useRef<WebViewErrorEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const onNavigationState = ({ nativeEvent: state }: NativeEvent<NavigationState>) => {
    const was = store.get().loading;
    store.set(state);
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
  const onError = ({ nativeEvent }: NativeEvent<WebViewErrorEvent>) => {
    if (nativeEvent.kind !== 'http') {
      errorRef.current = nativeEvent;
      setError(nativeEvent);
    }
    props.onError?.(nativeEvent);
  };

  return { error, loading, onNavigationState, onError };
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

/** The WebView provider and which features this package uses are supported. Null on iOS. */
WebView.getAndroidWebViewInfo = (): AndroidWebViewInfo | null =>
  Platform.OS === 'android'
    ? requireNativeModule<{ getAndroidWebViewInfo(): AndroidWebViewInfo }>(
        'MinimalWebView'
      ).getAndroidWebViewInfo()
    : null;

const styles = StyleSheet.create({ fill: { flex: 1 } });

/** The navigation state of a mounted `<WebView ref={ref}>`; re-renders on every change. */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState {
  return useSyncExternalStore(
    (listener) => (ref.current as InternalRef | null)?.[STORE].subscribe(listener) ?? (() => {}),
    () => (ref.current as InternalRef | null)?.[STORE].get() ?? INITIAL_STATE
  );
}
