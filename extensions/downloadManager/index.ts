import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Saves the page's http and https downloads into the device's Downloads folder with Android's Download Manager, whose
 * notification shows the progress, and shows a toast: react-native-webview's Android downloads, with its
 * `downloadingMessage`. Null on iOS.
 *
 * It takes them before `onDownload` does. `onDownload`, or else the core's external open, still gets `blob:` and
 * `data:` downloads, and one the Download Manager refuses, as when it is disabled.
 *
 * The Download Manager fetches the file again, with the page's cookies and user agent: a download that needs a POST
 * or other headers fails.
 * @android
 * @group Extensions
 */
export const downloadManager = (options?: {
  /**
   * The toast's text.
   * @default `'Downloading'`
   */
  downloadingMessage?: string;
}): HookExtension | null =>
  Platform.OS === 'android'
    ? { key: '@react-native-minimal-webview/extensions.downloadManager', options }
    : null;
