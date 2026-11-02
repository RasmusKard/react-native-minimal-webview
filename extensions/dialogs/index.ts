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

/**
 * Answers the page's `alert`, `confirm` and `prompt` with `onDialog` instead of the native dialogs; the page waits for
 * the answer. Not in react-native-webview, whose dialogs are native.
 *
 * The return value (a promise is awaited) is the answer: `true` accepts a confirm, a string is a prompt's text, and
 * anything else, a throw too, dismisses the dialog (confirm false, prompt null). An alert's answer doesn't matter.
 *
 * `signal` aborts when native stops waiting for the answer, and the dialog is then dismissed;
 * [`HookExtension.onEvent`](https://rasmuskard.github.io/react-native-minimal-webview/types/HookExtension.html#onevent)
 * has the rules.
 *
 * Without this extension, the default dialogs show, as `WebViewProps` describes.
 * @group Extensions
 */
export const dialogs = (
  onDialog: (dialog: Dialog, signal: AbortSignal) => unknown
): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.dialogs',
  // Each dialog is an ask, which has a signal; the event's name is the dialog's type.
  onEvent: ({ name, payload }, signal) =>
    onDialog({ ...payload, type: name } as Dialog, signal as AbortSignal),
});
