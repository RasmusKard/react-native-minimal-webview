import { act } from 'react';
import { createRoot } from 'test-renderer';

import { WebView } from '../WebView';

// No mock of 'expo' here: jest-expo answers with mocks/MinimalWebView.ts, as it does in an app's tests.
test('renders under jest-expo without a mock of the native module', async () => {
  const root = createRoot();
  await act(async () => root.render(<WebView source={{ uri: 'https://example.com' }} />));
  expect(root.container.children).toHaveLength(1);
});

test('throws, naming the iOS floor, in a build without the native module', () => {
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({
      ...jest.requireActual<object>('expo'),
      requireOptionalNativeModule: () => null,
    }));
    const isolated = jest.requireActual<typeof import('../WebView')>('../WebView');
    expect(() => isolated.WebView({ source: { uri: 'https://example.com' } })).toThrow(
      /deployment target 17\.0/
    );
  });
});
