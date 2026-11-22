import { Platform } from 'react-native';

import type { InjectedScript } from './types';

/**
 * Gives pages react-native-webview's messaging over the bridge event `rnw`; pass it in `injectedScripts`.
 *
 * - The page's `window.ReactNativeWebView.postMessage(data)` arrives as `String(data)`.
 * - What you emit as `rnw` reaches the page as a `message` event on `window` on iOS and on `document` on Android, as
 *   react-native-webview does.
 * - There is no `injectedObjectJson`: `window.ReactNativeWebView` has `postMessage` only.
 *
 * It needs the `bridge` prop: only the main frame of the pages in `allowedOrigins` gets `window.ReactNativeWebView`.
 * Its `origins` are `['*']`, since the bridge already scopes it.
 * @see [Messaging example](https://rasmuskard.github.io/react-native-minimal-webview/guides/migrating-from-react-native-webview/#postmessage-and-onmessage)
 * @group Scripts
 */
export const reactNativeWebViewMessages: InjectedScript = {
  code: `if (window.nativeBridge) {
  window.ReactNativeWebView = { postMessage: (data) => window.nativeBridge.emit('rnw', String(data)) };
  window.nativeBridge.on('rnw', (data) =>
    ${Platform.OS === 'ios' ? 'window' : 'document'}.dispatchEvent(new MessageEvent('message', { data })));
}`,
  origins: ['*'],
};
