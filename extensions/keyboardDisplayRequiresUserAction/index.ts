import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * With `required` false, a page script's `focus()` on an input shows the keyboard, as a tap does.
 *
 * A change applies from the next focus.
 *
 * It has no effect from iOS 27. There, a script's focus shows the keyboard only while the WebView has focus, such as
 * after a touch, with or without this extension.
 *
 * It replaces a private WebKit method, so a WebKit update can stop it working.
 * @returns Null when `required` is true, which is the default behavior, and on Android.
 * @ios
 * @group Extensions
 */
export const keyboardDisplayRequiresUserAction = (required: boolean): HookExtension | null =>
  Platform.OS === 'ios' && !required
    ? { key: '@react-native-minimal-webview/extensions.keyboardDisplayRequiresUserAction' }
    : null;
