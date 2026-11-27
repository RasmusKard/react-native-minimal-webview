import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Makes the WebView itself transparent, so that the views behind it show where the page paints no background.
 *
 * Switched off, the WebView is opaque again, and white on Android.
 * @group Extensions
 */
export const transparentBackground = (): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.transparentBackground',
});
