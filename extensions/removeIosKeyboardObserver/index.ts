import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Stops the WebView from insetting its scroll view for the keyboard, for an app whose own native code handles the
 * keyboard: react-native-webview's `removeIosKeyboardObserver`. The page's `visualViewport` still shrinks for it. Null
 * on Android.
 *
 * It removes the WKWebView's own observers of the keyboard notifications, so switching it off doesn't add them back: a
 * new WebView, after a remount, has them again.
 * @ios
 * @group Extensions
 */
export const removeIosKeyboardObserver = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@react-native-minimal-webview/extensions.removeIosKeyboardObserver' }
    : null;
