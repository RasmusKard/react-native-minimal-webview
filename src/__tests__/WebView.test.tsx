import { act } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';

import { WebView } from '../WebView';
import type { WebViewProps } from '../types';

jest.mock('expo', () => ({
  requireNativeView: () => 'MinimalWebView',
  requireNativeModule: () => ({}),
}));

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
        native?.props.onError({ nativeEvent });
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
