import { Platform } from 'react-native';
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * A failed request other than the main frame's, for {@link onLoadSubResourceError}. It has the shape of the core's
 * `LoadErrorEvent` for a network error.
 * @android
 * @group Events
 */
export type SubResourceErrorEvent = {
  url: string;
  /** One of Android's `WebViewClient.ERROR_*` codes. */
  code: number;
  description: string;
};

/**
 * Calls `handler` for each of the page's requests that fails, such as an image, a script or an iframe. The main frame's
 * failure goes to `onError` instead.
 *
 * Only network errors are reported. A failed SSL check and a response with an HTTP error status, such as a 404, are
 * not.
 * @returns Null on iOS.
 * @android
 * @group Extensions
 */
export const onLoadSubResourceError = (
  handler: (event: SubResourceErrorEvent) => void
): HookExtension<HookEvent<'error', SubResourceErrorEvent>> | null =>
  Platform.OS === 'android'
    ? {
        key: '@react-native-minimal-webview/extensions.onLoadSubResourceError',
        onEvent: ({ payload }) => handler(payload),
      }
    : null;
