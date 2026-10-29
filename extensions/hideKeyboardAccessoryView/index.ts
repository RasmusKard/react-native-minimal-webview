import type { HookExtension } from 'minimal-rn-webview';
import { Platform } from 'react-native';

/**
 * Hides the bar above the keyboard (previous, next, done) for the page's inputs: react-native-webview's
 * `hideKeyboardAccessoryView`. Null on Android.
 *
 * It changes a private WebKit view, as react-native-webview does, so a WebKit update can stop it working.
 * @ios
 * @group Extensions
 */
export const hideKeyboardAccessoryView = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@minimal-rn-webview/extensions.hideKeyboardAccessoryView', options: true }
    : null;
