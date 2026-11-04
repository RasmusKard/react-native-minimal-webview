import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Makes the WebView itself transparent, so that the views behind it show where the page paints no background:
 * react-native-webview's `style={{ backgroundColor: 'transparent' }}`. Switched off, it is opaque again; on Android,
 * white.
 * @group Extensions
 */
export const transparentBackground = (): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.transparentBackground',
});
