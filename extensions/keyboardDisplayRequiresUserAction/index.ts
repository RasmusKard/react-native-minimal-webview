import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * With `required` false, a page script's `focus()` on an input shows the keyboard, as a tap does:
 * react-native-webview's `keyboardDisplayRequiresUserAction`. Null when `required` is true, WebKit's default, and on
 * Android. A change applies from the next focus.
 *
 * Without it, WebKit's own rules show the keyboard only for some focuses, such as one in a tap's handler or from the
 * ref's `evaluate`.
 *
 * It replaces a private WebKit method, as react-native-webview does, so a WebKit update can stop it working.
 * @ios
 * @group Extensions
 */
export const keyboardDisplayRequiresUserAction = (required: boolean): HookExtension | null =>
  Platform.OS === 'ios' && !required
    ? { key: '@react-native-minimal-webview/extensions.keyboardDisplayRequiresUserAction' }
    : null;
