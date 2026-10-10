import { act } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView } from '../WebView';
import type { WebViewProps } from '../types';

const mockAnswer = jest.fn();
// A host element named MinimalWebView whose ref has the native `answer` method.
jest.mock('expo', () => {
  const { createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  return {
    requireNativeView:
      () =>
      ({ ref, ...props }: { ref: unknown }) => {
        useImperativeHandle(ref as never, () => ({ answer: mockAnswer }));
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
    expect(error).toHaveBeenCalledWith('[minimal-rn-webview] onPermissionRequest failed', expect.any(Error));
    await fire('httpAuthRequest', { host: 'example.com', realm: 'r' }, 3);
    expect(mockAnswer).toHaveBeenLastCalledWith(3, { value: null });
    expect(authRequest).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
