import type { HookExtension } from 'react-native-minimal-webview';

/**
 * A page's `alert`, `confirm` or `prompt`, for {@link dialogs}.
 * @group Events
 */
export type Dialog = {
  type: 'alert' | 'confirm' | 'prompt';
  message: string;
  /** A prompt's default text; null for an alert or a confirm. */
  defaultValue: string | null;
  /** The URL of the page (iOS: of the frame) that opened it. */
  url: string;
  /**
   * Whether the main frame opened it.
   * @ios
   */
  isTopFrame?: boolean;
};

const KEY = '@react-native-minimal-webview/extensions.dialogs';

/**
 * Answers the page's `alert`, `confirm` and `prompt` with `onDialog` instead of the native dialogs; the page waits for
 * the answer. Not in react-native-webview, whose dialogs are native.
 *
 * The return value (a promise is awaited) is the answer: `true` accepts a confirm, a string is a prompt's text, and
 * anything else, a throw too, dismisses the dialog (confirm false, prompt null). An alert's answer doesn't matter.
 * There is no timeout: `signal` aborts when the page goes away first (a crash, an unmount), and the dialog is then
 * dismissed. Without it, the core's dialogs show.
 * @group Extensions
 */
export const dialogs = (
  onDialog: (dialog: Dialog, signal: AbortSignal) => unknown
): HookExtension => ({
  key: KEY,
  options: true,
  // Each dialog is an ask, which has a signal; the event's name after the key is the dialog's type.
  onEvent: ({ name, payload }, signal) =>
    onDialog({ ...payload, type: name.slice(KEY.length + 1) } as Dialog, signal as AbortSignal),
});
