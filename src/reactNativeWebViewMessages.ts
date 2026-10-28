import { Platform } from 'react-native';

import type { InjectedScript } from './types';

/**
 * react-native-webview's messaging, for `injectedScripts`: the page's `window.ReactNativeWebView.postMessage(data)`
 * emits `String(data)` as the bridge event `rnw`, for `bridge.on('rnw', …)`, and `bridge.emit('rnw', data)` dispatches
 * a `message` event with that `data` on `window` on iOS and on `document` on Android, as react-native-webview does. It
 * needs the `bridge` prop: only the main frame of the pages in `allowedOrigins` gets `window.ReactNativeWebView`.
 */
export const reactNativeWebViewMessages: InjectedScript = {
  // Runs after the bridge's own script, so `window.nativeBridge` already exists where the bridge is installed.
  code: `if (window.nativeBridge) {
  window.ReactNativeWebView = { postMessage: (data) => window.nativeBridge.emit('rnw', String(data)) };
  window.nativeBridge.on('rnw', (data) =>
    ${Platform.OS === 'ios' ? 'window' : 'document'}.dispatchEvent(new MessageEvent('message', { data })));
}`,
};
