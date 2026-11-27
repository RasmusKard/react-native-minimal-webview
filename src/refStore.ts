import {
  type Ref,
  type RefObject,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import type { NavigationState, WebViewRef, WebViewRefObject } from './types';

const INITIAL_STATE: NavigationState = {
  url: '',
  pendingUrl: null,
  title: '',
  loading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  outcome: null,
};

type Adapter = {
  nav: WebViewRefObject;
  attach(handle: WebViewRef, state: NavigationState): void;
  update(handle: WebViewRef, state: NavigationState): void;
  detach(handle: WebViewRef): void;
};

const adapters = new WeakMap<object, Adapter>();

function adapterFor(ref: object) {
  let adapter = adapters.get(ref);
  if (!adapter) adapters.set(ref, (adapter = createAdapter()));
  return adapter;
}

function createAdapter(): Adapter {
  let attached: WebViewRef | null = null;
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const set = (next: NavigationState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const nav: WebViewRefObject = {
    get current() {
      return attached;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    nav,
    attach(handle, initial) {
      if (__DEV__ && attached) {
        console.warn(
          '[react-native-minimal-webview] This ref is already attached to a mounted WebView; the new one replaces it. Give each WebView its own ref.'
        );
      }
      attached = handle;
      set(initial);
    },
    update(handle, next) {
      if (attached === handle) set(next);
    },
    detach(handle) {
      if (attached !== handle) return;
      attached = null;
      set(INITIAL_STATE);
    },
  };
}

/**
 * Creates a ref to pass as a WebView's `ref`. A module or a store can hold it, so that code outside React can read the
 * navigation state and call the WebView.
 * @see [Outside React example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#outside-react)
 * @group WebView
 */
export function createWebViewRef(): WebViewRefObject {
  const adapter = createAdapter();
  adapters.set(adapter.nav, adapter);
  return adapter.nav;
}

/**
 * Returns a function that records a new state, passes it to the attached ref and returns the previous state.
 */
export function useAttach(
  ref: Ref<WebViewRef> | undefined,
  handle: WebViewRef
): (state: NavigationState) => NavigationState {
  const last = useRef(INITIAL_STATE);
  const adapter = ref && typeof ref === 'object' ? adapterFor(ref) : undefined;
  useImperativeHandle(adapter?.nav === ref ? undefined : ref, () => handle, [handle]);
  useLayoutEffect(() => {
    if (!adapter) return undefined;
    adapter.attach(handle, last.current);
    return () => adapter.detach(handle);
  }, [adapter, handle]);
  return (state) => {
    const was = last.current;
    last.current = state;
    adapter?.update(handle, state);
    return was;
  };
}

/**
 * Returns the navigation state of the WebView mounted with `ref`, which can come from `useRef`, `createRef` or
 * `createWebViewRef`. It re-renders on every change, `progress` included, and follows the WebView across a remount.
 * @see [Navigation state example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-state)
 * @group Navigation
 */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState;
/**
 * Returns what `select` returns for the navigation state of the WebView mounted with `ref`. It re-renders only when
 * that value changes by `Object.is`, and follows the WebView across a remount.
 *
 * `select` must be pure, because it can run more than once for a state. It can be a new function at each render. A
 * `select` that returns a new object or array each time re-renders on every state change.
 */
export function useWebViewState<T>(
  ref: RefObject<WebViewRef | null>,
  select: (state: NavigationState) => T
): T;
export function useWebViewState<T>(
  ref: RefObject<WebViewRef | null>,
  select?: (state: NavigationState) => T
): NavigationState | T {
  const { nav } = adapterFor(ref);
  const getSnapshot = useMemo<() => NavigationState | T>(
    () => (select ? selectFrom(nav.getState, select) : nav.getState),
    [nav, select]
  );
  return useSyncExternalStore(nav.subscribe, getSnapshot);
}

function selectFrom<T>(getState: () => NavigationState, select: (state: NavigationState) => T) {
  let last: { state: NavigationState; selected: T } | undefined;
  return () => {
    const state = getState();
    if (last?.state !== state) last = { state, selected: select(state) };
    return last.selected;
  };
}
