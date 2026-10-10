import { requireNativeView } from 'expo';
import { type Ref, type RefObject, useImperativeHandle, useRef, useSyncExternalStore } from 'react';

import type { NavigationState, WebViewProps, WebViewRef } from './types';

type NativeEvent<T> = { nativeEvent: T };

type NativeProps = {
  ref: Ref<NativeMethods>;
  source: WebViewProps['source'];
  style: WebViewProps['style'];
  onNavigationState: (event: NativeEvent<NavigationState>) => void;
};

/** Props that pass straight through to the native view. */
const PASSTHROUGH = [
  'navigationRules',
  'userAgent',
  'applicationNameForUserAgent',
  'thirdPartyCookiesEnabled',
  'mediaPlaybackRequiresUserAction',
  'allowsInlineMediaPlayback',
  'scrollEnabled',
  'bounces',
  'showsScrollIndicators',
  'javaScriptCanOpenWindowsAutomatically',
] as const;
type Passthrough = Pick<WebViewProps, (typeof PASSTHROUGH)[number]>;

/** Every prop that is not a `ViewProps` one, so it never reaches the outermost view. */
const OWN = [
  ...PASSTHROUGH,
  ...([
    'source',
    'injectedScripts',
    'webviewDebuggingEnabled',
    'bridge',
    'extensions',
    'renderLoading',
    'renderError',
    'onNavigationRequest',
    'onOpenExternal',
    'onNavigation',
    'onNavigationStateChange',
    'onError',
    'onProcessGone',
    'onLoadStart',
    'onLoad',
    'onLoadEnd',
    'children',
  ] as const),
] satisfies (Exclude<keyof WebViewProps, keyof ViewProps> | 'children')[];
type Unlisted = Exclude<Exclude<keyof WebViewProps, keyof ViewProps>, (typeof OWN)[number]>;
// A prop missing from OWN fails to compile here, by name.
const OWN_SET: Set<string> &
  ([Unlisted] extends [never] ? unknown : Record<Unlisted, 'missing from OWN'>) = new Set(OWN);

type NativeProps = ViewProps &
  Passthrough &
  Pick<WebViewProps, 'source' | 'injectedScripts' | 'webviewDebuggingEnabled'> & {
    ref: Ref<NativeMethods>;
    bridgeScript: string | undefined;
    bridgeOrigins: string[] | undefined;
    extensions: ReturnType<typeof nativeSpecs>;
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
    const call = <K extends keyof NativeMethods>(name: K) => native.current?.[name];
    return {
      goBack: () => void call('goBack')?.(),
      goForward: () => void call('goForward')?.(),
      reload: () => void call('reload')?.(),
      stopLoading: () => void call('stopLoading')?.(),
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

  return (
    <NativeWebView
      ref={native}
      source={props.source}
      style={props.style}
      onNavigationState={onNavigationState}
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
