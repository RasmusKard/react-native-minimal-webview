import { Platform } from 'react-native';
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * A failed request that isn't the main frame's, for {@link onLoadSubResourceError}: shaped as the core's
 * `LoadErrorEvent` for a network error.
 * @android
 * @group Events
 */
export type SubResourceErrorEvent = {
  url: string;
  /** Android's `WebViewClient.ERROR_*`. */
  code: number;
  description: string;
};

/**
 * Calls `handler` for each of the page's requests that fails, such as an image, a script or an iframe, but not the
 * main frame's, which goes to `onError`: react-native-webview's `onLoadSubResourceError`. Null on iOS.
 *
 * A request whose SSL check fails isn't reported; react-native-webview's reports only those.
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
