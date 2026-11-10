import { type ReactNode, act, useState } from 'react';
import { createRoot } from 'test-renderer';

import { createWebViewRef, useAttach, useWebViewState } from '../refStore';
import type { NavigationState, WebViewRef, WebViewRefObject } from '../types';

afterEach(() => jest.restoreAllMocks());

const state = (changes: Partial<NavigationState>): NavigationState => ({
  url: 'https://example.com/',
  pendingUrl: null,
  title: '',
  loading: false,
  progress: 0,
  canGoBack: false,
  canGoForward: false,
  outcome: null,
  ...changes,
});

/** A page load: its progress ticks, then its end, with the history it leaves. */
const load = [
  state({ loading: true, pendingUrl: 'https://example.com/a' }),
  state({ loading: true, pendingUrl: 'https://example.com/a', progress: 0.1 }),
  state({ loading: true, url: 'https://example.com/a', progress: 0.5, canGoBack: true }),
  state({ loading: true, url: 'https://example.com/a', progress: 0.9, canGoBack: true }),
  state({ url: 'https://example.com/a', progress: 1, canGoBack: true, outcome: 'finished' }),
];

/**
 * Renders `children` beside a WebView stand-in attached to `ref`. `publish` hands the ref the stand-in's next state, as
 * a navigation state event does; `unmount` unmounts the stand-in.
 */
async function mount(ref: WebViewRefObject, children: ReactNode) {
  let publish = (_next: NavigationState) => state({});
  let unmount = () => {};
  const handle = {} as WebViewRef;
  function StandIn() {
    publish = useAttach(ref, handle);
    return null;
  }
  function Host() {
    const [mounted, setMounted] = useState(true);
    unmount = () => setMounted(false);
    return mounted ? <StandIn /> : null;
  }
  await act(async () =>
    createRoot().render(
      <>
        {children}
        <Host />
      </>
    )
  );
  return {
    publish: (next: NavigationState) => act(async () => void publish(next)),
    unmount: () => act(async () => unmount()),
  };
}

// Each component records what it rendered with; a typed array checks the value's type follows the selector.
describe('useWebViewState', () => {
  it('re-renders with a selector only when what it selects changes', async () => {
    const ref = createWebViewRef();
    const selected: boolean[] = [];
    const whole: NavigationState[] = [];
    function BackButton() {
      selected.push(useWebViewState(ref, (s) => s.canGoBack));
      return null;
    }
    function Everything() {
      whole.push(useWebViewState(ref));
      return null;
    }
    const { publish } = await mount(
      ref,
      <>
        <BackButton />
        <Everything />
      </>
    );
    const [rendered, renderedWhole] = [selected.length, whole.length];
    for (const next of load) await publish(next);
    expect(selected.slice(rendered)).toEqual([true]);
    expect(whole.slice(renderedWhole)).toEqual(load); // without one, at every change
    await publish(state({}));
    expect(selected.slice(rendered)).toEqual([true, false]);
  });

  it('takes a selector that makes a new object at each render, and re-renders once per change', async () => {
    const errors = jest.spyOn(console, 'error');
    const ref = createWebViewRef();
    const selected: { url: string; progress: number }[] = [];
    function Line() {
      selected.push(useWebViewState(ref, (s) => ({ url: s.url, progress: s.progress })));
      return null;
    }
    const { publish } = await mount(ref, <Line />);
    const rendered = selected.length;
    await publish(load[1]);
    await publish(load[2]);
    expect(selected.slice(rendered)).toEqual([
      { url: 'https://example.com/', progress: 0.1 },
      { url: 'https://example.com/a', progress: 0.5 },
    ]);
    expect(errors).not.toHaveBeenCalled(); // React's error for a snapshot that changes without a change
  });

  it('selects with the selector of the last render', async () => {
    const ref = createWebViewRef();
    let show = (_key: 'url' | 'title') => {};
    const selected: string[] = [];
    function Field() {
      const [key, setKey] = useState<'url' | 'title'>('url');
      show = setKey;
      selected.push(useWebViewState(ref, (s) => s[key]));
      return null;
    }
    const { publish } = await mount(ref, <Field />);
    await publish(state({ title: 'A' }));
    expect(selected.at(-1)).toBe('https://example.com/');
    await act(async () => show('title'));
    expect(selected.at(-1)).toBe('A');
  });

  it('selects from the initial state once the WebView unmounts', async () => {
    const ref = createWebViewRef();
    const selected: string[] = [];
    function Url() {
      selected.push(useWebViewState(ref, (s) => s.url));
      return null;
    }
    const { publish, unmount } = await mount(ref, <Url />);
    await publish(state({}));
    expect(selected.at(-1)).toBe('https://example.com/');
    await unmount();
    expect(selected.at(-1)).toBe('');
  });
});
