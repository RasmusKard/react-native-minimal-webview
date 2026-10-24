// The ref store: each ref object's navigation state and the WebView handle attached to it, behind createWebViewRef,
// useWebViewState and WebView's `ref`.
import {
  type Ref,
  type RefObject,
  useImperativeHandle,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';

import type { NavigationState, WebViewRef, WebViewRefObject } from './types';

/** The state while no WebView is mounted with a ref: an empty `url`, so a stale URL never looks valid. */
export const INITIAL_STATE: NavigationState = {
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
export type Attachment = { update(state: NavigationState): void; detach(): void };
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
          '[minimal-rn-webview] This ref is already attached to a mounted WebView; the new one replaces it. Give each WebView its own ref.'
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
 * A ref to pass as a WebView's `ref`, made outside React (a module, a store) so code outside React can use it. Its
 * `current` is whichever WebView is mounted with it, and it keeps its subscribers across remounts; `useWebViewState`
 * takes it too. Give each mounted WebView its own: with two, the last mounted wins (with a warning in development)
 * until it unmounts.
 */
export function createWebViewRef(): WebViewRefObject {
  const adapter = createAdapter();
  adapters.set(adapter.nav, adapter);
  return adapter.nav;
}

/**
 * Puts `handle` in a callback or plain ref. Any ref object also gets the navigation state through its adapter, which a
 * createWebViewRef one is, so its `current` comes from the adapter too.
 */
export function useAttach(
  ref: Ref<WebViewRef> | undefined,
  handle: WebViewRef,
  lastRef: RefObject<NavigationState>,
  attachmentRef: RefObject<Attachment | undefined>
) {
  const adapter = ref && typeof ref === 'object' ? adapterFor(ref) : undefined;
  useImperativeHandle(adapter?.nav === ref ? undefined : ref, () => handle, [handle]);
  useLayoutEffect(() => {
    if (!adapter) return undefined;
    const attached = adapter.attach(handle, lastRef.current);
    attachmentRef.current = attached;
    return () => {
      attached.detach();
      attachmentRef.current = undefined;
    };
  }, [adapter, handle, lastRef, attachmentRef]);
}

/**
 * The navigation state of the WebView mounted with `ref` (a `useRef`, `createRef` or `createWebViewRef` one);
 * re-renders on every change, and follows a remount. The initial state (`url: ''`) while none is mounted.
 * @see https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#navigation-state
 */
export function useWebViewState(ref: RefObject<WebViewRef | null>): NavigationState {
  const { nav } = adapterFor(ref);
  return useSyncExternalStore(nav.subscribe, nav.getState);
}
