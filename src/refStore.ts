// The ref store: each ref object's navigation state and the WebView handle attached to it, behind createWebViewRef,
// useWebViewState and WebView's `ref`.
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

/** The state while no WebView is mounted with a ref: an empty `url`, so a stale URL never looks valid. */
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

/** A mounted WebView's hold on its ref: it passes on the WebView's state, and lets go at unmount. */
type Attachment = { update(state: NavigationState): void; detach(): void };
type Adapter = {
  nav: WebViewRefObject;
  attach(handle: WebViewRef, state: NavigationState): Attachment;
};

/** The navigation object behind each ref object: created by createWebViewRef, or made on first use for a plain ref. */
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
    // Last attached wins, like a React ref; an earlier instance's later updates and detach are ignored.
    attach(handle, initial) {
      if (__DEV__ && attached) {
        console.warn(
          '[react-native-minimal-webview] This ref is already attached to a mounted WebView; the new one replaces it. Give each WebView its own ref.'
        );
      }
      attached = handle;
      set(initial);
      return {
        update: (next) => attached === handle && set(next),
        detach() {
          if (attached !== handle) return;
          attached = null;
          set(INITIAL_STATE);
        },
      };
    },
  };
}

/**
 * A ref to pass as a WebView's `ref`, made outside React (a module, a store) so code outside React can use it.
 * @group WebView
 */
export function createWebViewRef(): WebViewRefObject {
  const adapter = createAdapter();
  adapters.set(adapter.nav, adapter);
  return adapter.nav;
}

/**
 * Puts `handle` in a callback or plain ref. Any ref object also gets the navigation state through its adapter, which a
 * createWebViewRef one is, so its `current` comes from the adapter too. Returns a function that records a new state,
 * passes it to the attached ref and returns the previous state.
 */
export function useAttach(
  ref: Ref<WebViewRef> | undefined,
  handle: WebViewRef
): (state: NavigationState) => NavigationState {
  const last = useRef(INITIAL_STATE);
  const attachment = useRef<Attachment>(undefined);
  const adapter = ref && typeof ref === 'object' ? adapterFor(ref) : undefined;
  useImperativeHandle(adapter?.nav === ref ? undefined : ref, () => handle, [handle]);
  useLayoutEffect(() => {
    if (!adapter) return undefined;
    const attached = adapter.attach(handle, last.current);
    attachment.current = attached;
    return () => {
      attached.detach();
      attachment.current = undefined;
    };
  }, [adapter, handle]);
  return (state) => {
    const was = last.current;
    last.current = state;
    attachment.current?.update(state);
    return was;
  };
}

/**
 * The navigation state of the WebView mounted with `ref` (a `useRef`, `createRef` or `createWebViewRef` one);
 * re-renders on every change, `progress` included, and follows a remount. With `select`, it re-renders only when what
 * `select` picks changes.
 * @see [Navigation state example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#navigation-state)
 * @group Navigation
 */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState;
/**
 * What `select` returns for the navigation state of the WebView mounted with `ref`; re-renders only when that changes
 * (by `Object.is`), and follows a remount. `useWebViewState(ref, (state) => state.canGoBack)` doesn't re-render as a
 * page loads.
 *
 * `select` must be pure: it can run more than once for a state, and it can be a new function at each render. A new
 * object or array from it is never the last one, so it re-renders on every change.
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

/** `select` of the current state, run again only for another state: a snapshot is the same value until a change. */
function selectFrom<T>(getState: () => NavigationState, select: (state: NavigationState) => T) {
  let last: { state: NavigationState; selected: T } | undefined;
  return () => {
    const state = getState();
    if (last?.state !== state) last = { state, selected: select(state) };
    return last.selected;
  };
}
