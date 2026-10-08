import { requireNativeView } from 'expo';
import { type Ref, type RefObject, useImperativeHandle, useRef, useSyncExternalStore } from 'react';

import type { NavigationRequest, NavigationState, WebViewProps, WebViewRef } from './types';

type NativeEvent<T> = { nativeEvent: T };

type NativeProps = {
  ref: Ref<NativeMethods>;
  source: WebViewProps['source'];
  style: WebViewProps['style'];
  navigationRules: WebViewProps['navigationRules'];
  onNavigationState: (event: NativeEvent<NavigationState>) => void;
  onNavigationRequest: (event: NativeEvent<NavigationRequest & { id: number }>) => void;
};

type NativeMethods = {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
  resolveNavigationRequest(id: number, action: string): Promise<void>;
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

export function WebView({ ref, ...props }: WebViewProps & { ref?: Ref<WebViewRef> }) {
  const native = useRef<NativeMethods>(null);
  const store = useRef(createStore()).current;

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

  const onNavigationState = ({ nativeEvent: state }: NativeEvent<NavigationState>) => {
    const was = store.get().loading;
    store.set(state);
    props.onNavigationStateChange?.(state);
    if (!was && state.loading) props.onLoadStart?.(state);
    if (was && !state.loading) {
      props.onLoad?.(state);
      props.onLoadEnd?.(state);
    }
  };

  // Native blocks unanswered requests after 1 s and ignores late answers.
  const onNavigationRequest = async ({
    nativeEvent: { id, ...request },
  }: NativeEvent<NavigationRequest & { id: number }>) => {
    const action = (await props.onNavigationRequest?.(request)) ?? 'block';
    await native.current?.resolveNavigationRequest(id, action);
  };

  return (
    <NativeWebView
      ref={native}
      source={props.source}
      style={props.style}
      navigationRules={props.navigationRules}
      onNavigationState={onNavigationState}
      onNavigationRequest={onNavigationRequest}
    />
  );
}

/** The navigation state of a mounted `<WebView ref={ref}>`; re-renders on every change. */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState {
  return useSyncExternalStore(
    (listener) => (ref.current as InternalRef | null)?.[STORE].subscribe(listener) ?? (() => {}),
    () => (ref.current as InternalRef | null)?.[STORE].get() ?? INITIAL_STATE
  );
}
