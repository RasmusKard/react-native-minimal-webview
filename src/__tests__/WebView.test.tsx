import { act } from 'react';
import { Text } from 'react-native';
import { createRoot } from 'test-renderer';

import type { WebViewProps } from '../types';
import { WebView } from '../WebView';

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
  const container = root.container.queryAll((node) => node.type === 'View' && node.props.testID === 'web');
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
    const { native, container } = await render({ ...viewProps, renderLoading: () => <Text>Loading</Text> });
    expect(container).toMatchObject(viewProps);
    expect(native).not.toHaveProperty('testID');
    expect(container).not.toHaveProperty('renderLoading');
  });
});
