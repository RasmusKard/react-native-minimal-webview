import { type RefObject, act, createRef, useState } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView, createWebViewRef, useWebViewState } from '../WebView';
import type { NavigationState, WebViewProps, WebViewRef } from '../types';

const mockAnswer = jest.fn();
const mockNavigate = jest.fn();
const mockMount = jest.fn();
// A host element named MinimalWebView whose ref has the native `answer`, `navigate`, `evaluate` and `native`
// methods; `native` echoes its request as JSON.
jest.mock('expo', () => {
  const { createElement, useEffect, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  return {
    requireNativeView:
      () =>
      ({ ref, ...props }: { ref: unknown }) => {
        useEffect(() => {
          mockMount();
        }, []);
        useImperativeHandle(ref as never, () => ({
          answer: mockAnswer,
          navigate: mockNavigate,
          evaluate: async () => '{"a":1}',
          native: async (request: unknown) => JSON.stringify(request),
        }));
        return createElement('MinimalWebView', props);
      },
    requireNativeModule: () => ({ defaultUserAgent: 'Mozilla/5.0 (Android)' }),
  };
});

async function render(props: Partial<WebViewProps>) {
  const root = createRoot();
  await act(async () =>
    root.render(<WebView source={{ uri: 'https://example.com' }} onLoad={() => {}} {...props} />)
  );
  const native = root.container.queryAll((node) => node.type === 'MinimalWebView');
  return { native: native[0]?.props };
}

const viewProps = { testID: 'web', accessibilityLabel: 'Checkout' };

describe('WebView', () => {
  it('forwards ViewProps to the native view, but not its own props', async () => {
    const { native } = await render(viewProps);
    expect(native).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('onLoad');
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
    return { onError, onHttpError, fire };
  }

  it('reports an HTTP status to onHttpError only', async () => {
    const { onError, onHttpError, fire } = await renderErrors();
    await fire({ kind: 'http', url: 'https://example.com/x', code: 404, description: 'Not Found' });
    expect(onHttpError).toHaveBeenCalledWith({
      url: 'https://example.com/x',
      statusCode: 404,
      description: 'Not Found',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failed load to onError only', async () => {
    const { onError, onHttpError, fire } = await renderErrors();
    const failure = {
      kind: 'network',
      url: 'https://example.com/',
      code: -1009,
      description: 'offline',
    };
    await fire(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onHttpError).not.toHaveBeenCalled();
  });
});

describe('nativeOptions and bridge', () => {
  it('recreate the native view when they change, and keep it otherwise', async () => {
    const root = createRoot();
    const show = (nativeOptions: Record<string, unknown>) =>
      act(async () =>
        root.render(
          <WebView source={{ uri: 'https://example.com' }} nativeOptions={nativeOptions} />
        )
      );
    mockMount.mockClear();
    await show({ sample: { mode: 'a' }, other: 1 });
    await show({ other: 1, sample: { mode: 'a' } }); // the same options in another key order
    expect(mockMount).toHaveBeenCalledTimes(1);
    await show({ sample: { mode: 'b' }, other: 1 });
    expect(mockMount).toHaveBeenCalledTimes(2);
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props;
    expect(native?.nativeOptions).toEqual({ sample: { mode: 'b' }, other: 1 });
  });
});

describe('platform settings', () => {
  const settingsOf = async (props: Partial<WebViewProps>) =>
    JSON.parse((await render(props)).native?.settings as string) as Record<
      string,
      Record<string, unknown>
    >;

  it('are the defaults alone without props (jest runs as iOS)', async () => {
    expect(await settingsOf({})).toEqual({
      configuration: { mediaTypesRequiringUserActionForPlayback: 3 },
      preferences: { javaScriptCanOpenWindowsAutomatically: false },
      webView: { customUserAgent: null, inspectable: true },
    });
  });

  it('put userAgent over the app keys, the app keys over the defaults, and keep the other roots', async () => {
    const settings = await settingsOf({
      userAgent: 'Agent/1',
      ios: {
        configuration: {
          allowsInlineMediaPlayback: true,
          mediaTypesRequiringUserActionForPlayback: 0,
        },
        preferences: { javaScriptCanOpenWindowsAutomatically: true },
        webView: {
          customUserAgent: 'Overridden/0',
          inspectable: false,
          allowsBackForwardNavigationGestures: true,
        },
        scrollView: { bounces: false },
      },
    });
    expect(settings).toEqual({
      configuration: {
        mediaTypesRequiringUserActionForPlayback: 0,
        allowsInlineMediaPlayback: true,
      },
      preferences: { javaScriptCanOpenWindowsAutomatically: true },
      webView: {
        customUserAgent: 'Agent/1',
        inspectable: false,
        allowsBackForwardNavigationGestures: true,
      },
      scrollView: { bounces: false },
    });
  });

  it('recreate the native view for a changed configuration key, with the new settings', async () => {
    const root = createRoot();
    const show = (name: string) =>
      act(async () =>
        root.render(
          <WebView
            source={{ uri: 'https://example.com' }}
            ios={{ configuration: { applicationNameForUserAgent: name } }}
          />
        )
      );
    mockMount.mockClear();
    await show('App/1');
    await show('App/2');
    expect(mockMount).toHaveBeenCalledTimes(2);
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
      settings: string;
    };
    const settings = JSON.parse(native.settings) as { configuration: Record<string, unknown> };
    expect(settings.configuration.applicationNameForUserAgent).toBe('App/2');
  });

  it('logs native warnings', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createRoot();
    await act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} />));
    const native = root.container.queryAll((node) => node.type === 'MinimalWebView')[0]?.props as {
      onNativeEvent: (event: { nativeEvent: Record<string, unknown> }) => Promise<void>;
    };
    await act(() =>
      native.onNativeEvent({
        nativeEvent: {
          name: 'core.warning',
          payload: { message: 'ios.scrollView.nope: no such property' },
        },
      })
    );
    expect(warn).toHaveBeenCalledWith('[minimal-rn-webview] ios.scrollView.nope: no such property');
    expect(mockAnswer).not.toHaveBeenCalled();
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
        onNativeEvent: (event: { nativeEvent: Record<string, unknown> }) => Promise<void>;
      };
    const fire: Fire = (name, payload, askId) =>
      act(() => native().onNativeEvent({ nativeEvent: { name, payload, askId } }));
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
    await fire('core.fileRequest', { accept: [], multiple: false, capture: false }, 1);
    expect(onFileRequest).toHaveBeenCalledWith({ accept: [], multiple: false, capture: false });
    expect(mockAnswer).toHaveBeenCalledWith(1, { value: ['file:///a.txt'] });
    await fire('core.fullscreenChange', { active: true });
    expect(onFullscreenChange).toHaveBeenCalledWith({ active: true });
    const failure = { filename: 'a.txt', url: null, reason: 'HTTP 404' };
    await fire('core.download', failure);
    expect(onDownload).toHaveBeenCalledWith(failure);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it('answers block to a navigation request when the prop throws or returns nothing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onNavigationRequest = jest
      .fn()
      .mockResolvedValueOnce('allow')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('no'));
    const { fire, native } = await renderRequests({
      onNavigationRequest,
      onOpenExternal: () => {},
    });
    expect(native().requestHandlers).toEqual(['navigationRequest', 'openExternal']);
    const request = {
      url: 'https://a.example',
      mainFrame: true,
      newWindow: false,
      userInitiated: true,
    };
    await fire('core.navigationRequest', request, 1);
    expect(onNavigationRequest).toHaveBeenCalledWith(request);
    expect(mockAnswer).toHaveBeenLastCalledWith(1, { value: 'allow' });
    await fire('core.navigationRequest', request, 2);
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: null });
    await fire('core.navigationRequest', request, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: 'block' });
    error.mockRestore();
  });

  it('answers null when the prop is gone or throws, and routes other names to onNativeEvent', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onNativeEvent = jest.fn(({ name }: { name: string }) => `${name}!`);
    const { fire } = await renderRequests({
      onPermissionRequest: () => {
        throw new Error('no');
      },
      onNativeEvent,
    });
    await fire(
      'core.permissionRequest',
      { origin: 'https://example.com', resources: ['camera'] },
      2
    );
    expect(mockAnswer).toHaveBeenLastCalledWith(2, { value: null });
    expect(error).toHaveBeenCalledWith(
      '[minimal-rn-webview] onPermissionRequest failed',
      expect.any(Error)
    );
    await fire('core.fileRequest', { accept: [], multiple: false, capture: false }, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: null });
    expect(onNativeEvent).not.toHaveBeenCalled();
    await fire('pageCounter.pick', { a: 1 }, 4);
    expect(onNativeEvent).toHaveBeenCalledWith({ name: 'pageCounter.pick', payload: { a: 1 } });
    expect(mockAnswer).toHaveBeenLastCalledWith(4, { value: 'pageCounter.pick!' });
    await fire('pageCounter.note', { b: 2 });
    expect(mockAnswer).toHaveBeenCalledTimes(3);
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

  it("createWebViewRef's current is the mounted WebView's ref, and null while none is", async () => {
    const ref = createWebViewRef();
    expect(ref.current).toBeNull();
    expect(await ref.current?.get('scrollView.bounces')).toBeUndefined();

    const root = createRoot();
    await act(async () =>
      root.render(<WebView ref={ref} source={{ uri: 'https://example.com' }} />)
    );
    ref.current?.goBack();
    expect(mockNavigate).toHaveBeenCalledWith('back');
    expect(await ref.current?.evaluate('1')).toEqual({ a: 1 });
    expect(await ref.current?.get('scrollView.bounces')).toEqual({ get: 'scrollView.bounces' });
    expect(await ref.current?.call('clearCache', [true])).toEqual({
      call: 'clearCache',
      args: '[true]',
    });
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
