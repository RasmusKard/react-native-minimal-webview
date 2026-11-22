import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * A page's `alert`, `confirm` or `prompt`, for {@link dialogs}.
 * @group Events
 */
export type Dialog =
  | {
      type: 'alert' | 'confirm';
      message: string;
      /** The URL of the frame that opened it. */
      url: string;
      /**
       * Whether the main frame opened it.
       * @ios
       */
      mainFrame?: boolean;
    }
  | {
      type: 'prompt';
      message: string;
      /** The prompt's default text. */
      defaultValue: string | null;
      /** The URL of the frame that opened it. */
      url: string;
      /**
       * Whether the main frame opened it.
       * @ios
       */
      mainFrame?: boolean;
    };

/**
 * Answers the page's `alert`, `confirm` and `prompt` with `onDialog` instead of the native dialogs; the page waits for
 * the answer.
 *
 * Not in react-native-webview, whose dialogs are native.
 *
 * The return value (a promise is awaited) is the answer: `true` accepts a confirm, a string is a prompt's text, and
 * anything else, a throw too, dismisses the dialog (confirm false, prompt null). An alert's answer doesn't matter.
 *
 * `signal` aborts when the core stops waiting for the answer, and the dialog is then dismissed;
 * {@link HookExtension.onAsk} has the rules.
 *
 * Without this extension, the default dialogs show, as `WebViewProps` describes.
 * @group Extensions
 */
export const dialogs = (
  onDialog: (dialog: Dialog, signal: AbortSignal) => unknown
): HookExtension<HookEvent<Dialog['type'], Dialog>> => ({
  key: '@react-native-minimal-webview/extensions.dialogs',
  onAsk: async ({ payload }, signal) => {
    const answer = await onDialog(payload, signal);
    if (payload.type === 'confirm') return answer === true;
    return typeof answer === 'string' ? answer : null;
  },
});
