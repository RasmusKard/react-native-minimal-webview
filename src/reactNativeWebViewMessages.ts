import { Platform } from 'react-native';

import type { InjectedScript } from './types';

/**
 * react-native-webview's messaging, for `injectedScripts`, carried by the bridge event `rnw`.
 *
 * The page's `window.ReactNativeWebView.postMessage(data)` arrives as `String(data)`, and what you emit reaches the
 * page as a `message` event on `window` on iOS and on `document` on Android, as react-native-webview does.
 *
 * It needs the `bridge` prop: only the main frame of the pages in `allowedOrigins` gets `window.ReactNativeWebView`,
 * and only `postMessage`: there is no `injectedObjectJson`. Its `origins` are `['*']`, since the bridge already scopes
 * it.
 * @see [Messaging example](https://rasmuskard.github.io/react-native-minimal-webview/guides/migrating-from-react-native-webview/#postmessage-and-onmessage)
 * @group Scripts
 */
export const reactNativeWebViewMessages: InjectedScript = {
  // Runs after the bridge's own script, so `window.nativeBridge` already exists where the bridge is installed.
  code: `if (window.nativeBridge) {
  window.ReactNativeWebView = { postMessage: (data) => window.nativeBridge.emit('rnw', String(data)) };
  window.nativeBridge.on('rnw', (data) =>
    ${Platform.OS === 'ios' ? 'window' : 'document'}.dispatchEvent(new MessageEvent('message', { data })));
}`,
  origins: ['*'],
};
