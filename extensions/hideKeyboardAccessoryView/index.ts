import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Hides the bar with previous, next and done above the keyboard for the page's inputs.
 *
 * It changes a private WebKit view, so a WebKit update can stop it working.
 * @returns Null on Android.
 * @ios
 * @group Extensions
 */
export const hideKeyboardAccessoryView = (): HookExtension | null =>
  Platform.OS === 'ios'
    ? { key: '@react-native-minimal-webview/extensions.hideKeyboardAccessoryView' }
    : null;
