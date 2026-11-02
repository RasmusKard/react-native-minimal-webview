import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

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
    ? { key: '@react-native-minimal-webview/extensions.nestedScrollEnabled' }
    : null;
