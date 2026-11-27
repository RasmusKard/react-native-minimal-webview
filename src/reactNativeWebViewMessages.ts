import { Platform } from 'react-native';

import type { InjectedScript } from './types';

/**
 * Gives pages react-native-webview's messaging, carried by the bridge event `rnw`. Pass it in `injectedScripts`.
 *
 * - The page's `window.ReactNativeWebView.postMessage(data)` arrives as `String(data)`.
 * - What you emit as `rnw` reaches the page as a `message` event on `window` on iOS and on `document` on Android. As
 *   every {@link Bridge} event, it waits for the page's `DOMContentLoaded`, where react-native-webview's `postMessage`
 *   delivered at once. So a reply to a message the page sent before then arrives only after it, and a page that times
 *   out its request may give up first.
 * - `window.ReactNativeWebView` has `postMessage` only, without `injectedObjectJson`.
 *
 * It needs the `bridge` prop. Only the main frame of a page in `allowedOrigins` gets `window.ReactNativeWebView`. Its
 * `origins` are `['*']`, because the bridge already limits which pages get it.
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
