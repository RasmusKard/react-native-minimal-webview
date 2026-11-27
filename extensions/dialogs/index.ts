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
 * Answers the page's `alert`, `confirm` and `prompt` with `onDialog` instead of the native dialogs. The page waits for
 * the answer.
 *
 * `onDialog` returns the answer, or a promise of it. `true` accepts a confirm, and a string is a prompt's text. Anything
 * else, or a throw, dismisses the dialog, so a confirm gets `false` and a prompt gets `null`. An alert ignores the
 * answer.
 *
 * `signal` aborts when the core stops waiting for the answer, and the dialog is then dismissed.
 * {@link HookExtension.onAsk} says when that happens.
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
