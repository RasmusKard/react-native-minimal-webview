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
import { Platform, StyleSheet, View } from 'react-native';

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

/** `askId` is set when native waits for the answer (ExtensionHost.ask). */
type ExtensionEvent = {
  name: string;
  event: string;
  payload: Record<string, unknown>;
  askId?: number;
};

type NativeProps = Pick<
  WebViewProps,
  | 'source'
  | 'style'
  | 'navigationRules'
  | 'injectedScripts'
  | 'userAgent'
  | 'applicationNameForUserAgent'
  | 'thirdPartyCookies'
  | 'mediaPlaybackRequiresUserAction'
  | 'allowsInlineMediaPlayback'
  | 'scrollEnabled'
  | 'bounces'
  | 'showsScrollIndicators'
  | 'webviewDebuggingEnabled'
> & {
  ref: Ref<NativeMethods>;
  bridgeScript: string | undefined;
  bridgeOrigins: string[] | undefined;
  extensions: WebViewExtension['native'][] | undefined;
  openExternalInJS: boolean;
  onNavigation: (event: NativeEvent<NavigationEvent>) => void;
  onNavigationState: (event: NativeEvent<NavigationState>) => void;
  onNavigationRequest: (event: NativeEvent<NavigationRequest & { id: number }>) => void;
  onBridge: (event: NativeEvent<{ message?: string; unavailable?: boolean }>) => void;
  onExtension: (event: NativeEvent<ExtensionEvent>) => void;
  onError: (event: NativeEvent<WebViewErrorEvent>) => void;
  onProcessGone: (event: NativeEvent<ProcessGoneEvent>) => void;
};

type NativeMethods = {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
  bridgePost(message: string): Promise<void>;
  /** Also carries the answer to any native `ask` (navigation or extension): method `__answer`. */
  extensionCall(name: string, method: string, args: Record<string, unknown>): Promise<unknown>;
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

type Store = {
  get(): NavigationState;
  subscribe(listener: () => void): () => void;
};

type InternalRef = WebViewRef & { [STORE]: Store };

function createStore(): Store & { set(state: NavigationState): void } {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parseResult(json: string | null): unknown {
  return json === null || json === '' ? undefined : (JSON.parse(json) as unknown);
}

/** Props from extension helpers merge in list order; explicit props win. */
function withExtensionProps(props: WebViewProps): WebViewProps {
  const fromExtensions = props.extensions?.map((extension) => extension.props ?? {}) ?? [];
  return Object.assign({}, ...fromExtensions, props) as WebViewProps;
}

export function WebView({ ref, ...ownProps }: WebViewProps & { ref?: Ref<WebViewRef> }) {
  const props = withExtensionProps(ownProps);
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
      evaluate: async (script) => parseResult((await native.current?.evaluate(script)) ?? null),
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

  const onBridge = ({ nativeEvent }: NativeEvent<{ message?: string; unavailable?: boolean }>) => {
    if (nativeEvent.message !== undefined) connection?.receive(nativeEvent.message);
    else connection?.markUnavailable();
  };

  const answer = (name: string, askId: number, value: unknown) =>
    native.current?.extensionCall(name, '__answer', { askId, value: value ?? null });

  const onExtension = async ({
    nativeEvent: { name, event, payload, askId },
  }: NativeEvent<ExtensionEvent>) => {
    const extension = props.extensions?.find((candidate) => candidate.native.name === name);
    const value = await extension?.onEvent?.(event, payload);
    if (askId !== undefined) await answer(name, askId, value);
  };

  const onNavigation = ({ nativeEvent }: NativeEvent<NavigationEvent>) => {
    if (nativeEvent.action === 'external') props.onOpenExternal?.(nativeEvent.url);
    props.onNavigation?.(nativeEvent);
  };

  // Native blocks unanswered requests after 1 s and ignores late answers.
  const onNavigationRequest = async ({
    nativeEvent: { id, ...request },
  }: NativeEvent<NavigationRequest & { id: number }>) => {
    await answer('', id, (await props.onNavigationRequest?.(request)) ?? 'block');
  };

  const webView = (
    <NativeWebView
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

/** Native props that pass straight through, with extension scripts first. */
function settingsOf(props: WebViewProps) {
  return {
    navigationRules: props.navigationRules,
    injectedScripts: [
      ...(props.extensions?.flatMap((extension) => extension.scripts ?? []) ?? []),
      ...(props.injectedScripts ?? []),
    ],
    userAgent: props.userAgent,
    applicationNameForUserAgent: props.applicationNameForUserAgent,
    thirdPartyCookies: props.thirdPartyCookies,
    mediaPlaybackRequiresUserAction: props.mediaPlaybackRequiresUserAction,
    allowsInlineMediaPlayback: props.allowsInlineMediaPlayback,
    scrollEnabled: props.scrollEnabled,
    bounces: props.bounces,
    showsScrollIndicators: props.showsScrollIndicators,
    webviewDebuggingEnabled: props.webviewDebuggingEnabled ?? __DEV__,
  };
}

/**
 * Load events and the overlay state. The current load's main-frame error: onLoad fires only without one, and
 * renderError shows it until the next load starts.
 */
function useLoadEvents(props: WebViewProps, store: ReturnType<typeof createStore>) {
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

  const onError = ({ nativeEvent }: NativeEvent<WebViewErrorEvent>) => {
    errorRef.current = nativeEvent;
    setError(nativeEvent);
    props.onError?.(nativeEvent);
  };

  return { error, loading, onNavigationState, onError };
}

/** The error screen wins over the loading screen; both cover the WebView until the next load starts or finishes. */
function withOverlay(webView: ReactElement, props: WebViewProps, error: WebViewErrorEvent | null, loading: boolean) {
  if (!props.renderLoading && !props.renderError) return webView;
  const overlay = error ? props.renderError?.(error) : loading ? props.renderLoading?.() : null;
  return (
    <View style={props.style}>
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
