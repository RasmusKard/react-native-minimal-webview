import { type RefObject, act, createRef, useState } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView, createWebViewRef, useWebViewState } from '../WebView';
import type { NavigationState, WebViewProps, WebViewRef } from '../types';

const mockAnswer = jest.fn();
const mockGoBack = jest.fn();
// A host element named MinimalWebView whose ref has the native `answer`, `goBack`, `evaluate` and `getUrl` methods.
jest.mock('expo', () => {
  const { createElement, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  return {
    requireNativeView:
      () =>
      ({ ref, ...props }: { ref: unknown }) => {
        useImperativeHandle(ref as never, () => ({
          answer: mockAnswer,
          goBack: mockGoBack,
          evaluate: async () => '{"a":1}',
          getUrl: async () => 'https://example.com/native',
        }));
        return createElement('MinimalWebView', props);
      },
    requireNativeModule: () => ({}),
  };
});

async function render(props: Partial<WebViewProps>) {
  const root = createRoot();
  await act(async () =>
    root.render(<WebView source={{ uri: 'https://example.com' }} onLoad={() => {}} {...props} />)
  );
  const native = root.container.queryAll((node) => node.type === 'MinimalWebView');
  const container = root.container.queryAll(
    (node) => node.type === 'View' && node.props.testID === 'web'
  );
  return { native: native[0]?.props, container: container[0]?.props };
}

const viewProps = { testID: 'web', accessibilityLabel: 'Checkout' };

describe('WebView', () => {
  it('forwards ViewProps to the native view, but not its own props', async () => {
    const { native } = await render(viewProps);
    expect(native).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('onLoad');
  });

  it('forwards them to the container instead when an overlay can cover the WebView', async () => {
    const { native, container } = await render({
      ...viewProps,
      renderLoading: () => <Text>Loading</Text>,
    });
    expect(container).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('testID');
    expect(container).not.toHaveProperty('renderLoading');
  });
});

describe('errors', () => {
  async function renderErrors() {
    const onError = jest.fn();
    const onHttpError = jest.fn();
    const root = createRoot();
    await act(async () =>
      root.render(
        <WebView
          source={{ uri: 'https://example.com' }}
          onError={onError}
          onHttpError={onHttpError}
          renderError={() => <Text>failed</Text>}
        />
      )
    );
    const fire = (nativeEvent: Record<string, unknown>) =>
      act(async () => {
        const [native] = root.container.queryAll((node) => node.type === 'MinimalWebView');
        const props = native?.props as
          { onError: (event: { nativeEvent: Record<string, unknown> }) => void } | undefined;
        props?.onError({ nativeEvent });
      });
    const failedShown = () =>
      root.container.queryAll((node) => node.type === 'Text' && node.props.children === 'failed')
        .length > 0;
    return { onError, onHttpError, fire, failedShown };
  }

  it('reports an HTTP status to onHttpError only, and keeps the site page', async () => {
    const { onError, onHttpError, fire, failedShown } = await renderErrors();
    await fire({ kind: 'http', url: 'https://example.com/x', code: 404, description: 'Not Found' });
    expect(onHttpError).toHaveBeenCalledWith({
      url: 'https://example.com/x',
      statusCode: 404,
      description: 'Not Found',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(failedShown()).toBe(false);
  });

  it('reports a failed load to onError only, and shows renderError', async () => {
    const { onError, onHttpError, fire, failedShown } = await renderErrors();
    const failure = {
      kind: 'network',
      url: 'https://example.com/',
      code: -1009,
      description: 'offline',
    };
    await fire(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onHttpError).not.toHaveBeenCalled();
    expect(failedShown()).toBe(true);
  });
});

describe('extensions and bridge', () => {
  it('are fixed at mount: a change warns once and native keeps the first specs', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createRoot();
    const show = (mode: 'a' | 'b') =>
      act(async () =>
        root.render(
          <WebView
            source={{ uri: 'https://example.com' }}
            extensions={[{ native: { name: 'sample', config: { mode } } }]}
          />
        )
      );
    await show('a');
    await show('a');
    expect(warn).not.toHaveBeenCalled();
    await show('b');
    await show('a');
    await show('b');
    expect(warn).toHaveBeenCalledTimes(1);
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props;
    expect(native?.extensions).toEqual([{ name: 'sample', config: { mode: 'a' }, handles: [] }]);
    warn.mockRestore();
  });
});

describe('page requests', () => {
  type Fire = (event: string, payload: Record<string, unknown>, askId?: number) => Promise<void>;

  async function renderRequests(props: Partial<WebViewProps>) {
    const root = createRoot();
    const show = (next: Partial<WebViewProps>) =>
      act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} {...next} />));
    await show(props);
    const native = () =>
      root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
        requestHandlers: string[];
        onExtension: (event: { nativeEvent: Record<string, unknown> }) => Promise<void>;
      };
    const fire: Fire = (event, payload, askId) =>
      act(() => native().onExtension({ nativeEvent: { name: 'core', event, payload, askId } }));
    return { show, native, fire };
  }

  beforeEach(() => mockAnswer.mockClear());

  it('tells native which requests have a prop, as the same array until that set changes', async () => {
    const { show, native } = await renderRequests({ onDownload: () => {} });
    const first = native().requestHandlers;
    expect(first).toEqual(['download']);
    await show({ onDownload: () => {} });
    expect(native().requestHandlers).toBe(first);
    await show({ onDownload: () => {}, onPermissionRequest: () => true });
    expect(native().requestHandlers).toEqual(['permissionRequest', 'download']);
    await show({});
    expect(native().requestHandlers).toEqual([]);
  });

  it('routes each request to its prop and answers with its result', async () => {
    const onFileRequest = jest.fn(async () => ['file:///a.txt']);
    const onFullscreenChange = jest.fn();
    const onDownload = jest.fn();
    const { fire } = await renderRequests({ onFileRequest, onFullscreenChange, onDownload });
    await fire('fileRequest', { accept: [], multiple: false, capture: false }, 1);
    expect(onFileRequest).toHaveBeenCalledWith({ accept: [], multiple: false, capture: false });
    expect(mockAnswer).toHaveBeenCalledWith(1, { value: ['file:///a.txt'] });
    await fire('fullscreenChange', { active: true });
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
    const failure = { filename: 'a.txt', url: null, reason: 'HTTP 404' };
    await fire('download', failure);
    expect(onDownload).toHaveBeenCalledWith(failure);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it('answers null when the prop is gone or throws, and leaves extensions to their own handlers', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const authRequest = jest.fn();
    const { fire } = await renderRequests({
      onPermissionRequest: () => {
        throw new Error('no');
      },
      extensions: [{ native: { name: 'other' }, on: { authRequest } }],
    });
    await fire('permissionRequest', { origin: 'https://example.com', resources: ['camera'] }, 2);
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: null });
    expect(error).toHaveBeenCalledWith(
      '[minimal-rn-webview] onPermissionRequest failed',
      expect.any(Error)
    );
    await fire('httpAuthRequest', { host: 'example.com', realm: 'r' }, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: null });
    expect(authRequest).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('navigation state across remounts', () => {
  const at = (url: string): NavigationState => ({
    url,
    pendingUrl: null,
    title: '',
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
  });
  const fireState = (root: ReturnType<typeof createRoot>, state: NavigationState, index = 0) =>
    act(async () => {
      const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[index];
      (
        native?.props as { onNavigationState: (event: { nativeEvent: NavigationState }) => void }
      ).onNavigationState({ nativeEvent: state });
    });

  it('createWebViewRef forwards to the mounted WebView, and does nothing while none is', async () => {
    const ref = createWebViewRef();
    expect(ref.current).toBeNull();
    ref.goBack();
    expect(await ref.evaluate('1')).toBeUndefined();
    expect(await ref.getUrl()).toBe('');
    expect(mockGoBack).not.toHaveBeenCalled();

    const root = createRoot();
    await act(async () =>
      root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
    expect(ref.current).not.toBeNull();
    ref.goBack();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(await ref.evaluate('1')).toEqual({ a: 1 });
    expect(await ref.getUrl()).toBe('https://example.com/native');
    await act(async () => root.unmount());
    expect(ref.current).toBeNull();
  });

  it('getState and subscribe follow attach, detach and re-attach; detach resets to the initial state', async () => {
    const ref = createWebViewRef();
    const listener = jest.fn();
    ref.subscribe(listener);
    const root = createRoot();
    const show = (key: number | null) =>
      act(async () =>
        root.render(
          <>
            {key === null ? null : (
              <WebView key={key} ref={ref} source={{ uri: 'https://example.com' }} />
            )}
          </>
        )
      );
    await show(1);
    await fireState(root, at('https://example.com/a'));
    expect(ref.getState().url).toBe('https://example.com/a');
    listener.mockClear();

    await show(2); // remount
    expect(listener).toHaveBeenCalled();
    expect(ref.getState().url).toBe('');
    await fireState(root, at('https://example.com/b'));
    expect(ref.getState().url).toBe('https://example.com/b');

    listener.mockClear();
    await show(null);
    expect(listener).toHaveBeenCalled();
    expect(ref.getState()).toEqual(at(''));
  });

  it('a second WebView with the same ref replaces the first, with a warning; the first unmounting leaves it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = createWebViewRef();
    const root = createRoot();
    const show = (first: boolean) =>
      act(async () =>
        root.render(
          <>
            {first ? <WebView ref={ref} source={{ uri: 'https://example.com' }} /> : null}
            <WebView ref={ref} source={{ uri: 'https://example.com' }} />
          </>
        )
      );
    await show(true);
    expect(warn).toHaveBeenCalledTimes(1);
    await fireState(root, at('https://example.com/second'), 1);
    await fireState(root, at('https://example.com/first'), 0);
    expect(ref.getState().url).toBe('https://example.com/second');
    await show(false);
    expect(ref.current).not.toBeNull();
    expect(ref.getState().url).toBe('https://example.com/second');
    warn.mockRestore();
  });

  it.each([
    ['createWebViewRef', () => createWebViewRef()],
    ['a plain ref', () => createRef<WebViewRef>()],
  ])(
    'useWebViewState follows a remount the caller does not re-render for, with %s',
    async (_, make) => {
      const ref = make() as RefObject<WebViewRef | null>;
      let remount = () => {};
      let renders = 0;
      function Reader() {
        renders++;
        return <Text>{useWebViewState(ref).url}</Text>;
      }
      function Host() {
        const [key, setKey] = useState(0);
        remount = () => setKey(key + 1);
        return <WebView key={key} ref={ref} source={{ uri: 'https://example.com' }} />;
      }
      const root = createRoot();
      await act(async () =>
        root.render(
          <>
            <Reader />
            <Host />
          </>
        )
      );
      const shown = () =>
        root.container.queryAll((node) => node.type === 'Text')[0]?.props.children as string;
      await fireState(root, at('https://example.com/a'));
      expect(shown()).toBe('https://example.com/a');
      await act(async () => remount());
      expect(shown()).toBe('');
      const before = renders;
      await fireState(root, at('https://example.com/b'));
      expect(shown()).toBe('https://example.com/b');
      expect(renders).toBeGreaterThan(before);
    }
  );
});
