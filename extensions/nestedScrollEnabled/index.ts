import type { HookExtension } from 'minimal-rn-webview';
import { Platform } from 'react-native';

/**
 * Keeps a swipe that starts on the page for the page, inside a scrolling parent such as a `ScrollView`:
 * react-native-webview's `nestedScrollEnabled`. Null on iOS.
 *
 * `android.webView.nestedScrollingEnabled` doesn't do this: the parent still takes the swipe.
 * @android
 * @group Extensions
 */
export const nestedScrollEnabled = (): HookExtension | null =>
  Platform.OS === 'android'
    ? { key: '@minimal-rn-webview/extensions.nestedScrollEnabled', options: true }
    : null;
