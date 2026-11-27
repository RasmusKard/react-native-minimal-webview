import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Stops the WebView from insetting its scroll view for the keyboard, for an app whose own native code handles the
 * keyboard.
 *
 * The page's `visualViewport` still shrinks for the keyboard. Switching it off doesn't undo it. A new WebView, after a
 * remount, insets for the keyboard again.
 * @returns Null on Android.
 * @ios
 * @group Extensions
 */
export const removeIosKeyboardObserver = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@react-native-minimal-webview/extensions.removeIosKeyboardObserver' }
    : null;
