import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Gives a swipe that starts on the page to the page, not to a scrolling parent such as a `ScrollView`.
 *
 * The `android.webView.nestedScrollingEnabled` setting doesn't do this. With that setting, the parent still takes the swipe.
 * @returns Null on iOS.
 * @android
 * @group Extensions
 */
export const nestedScrollEnabled = (): HookExtension | null =>
  Platform.OS === 'android'
    ? { key: '@react-native-minimal-webview/extensions.nestedScrollEnabled' }
    : null;
