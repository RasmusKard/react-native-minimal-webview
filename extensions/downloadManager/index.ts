import { Platform } from 'react-native';
import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Saves the page's `http:` and `https:` downloads into the device's Downloads folder with Android's Download Manager,
 * and shows a toast. The Download Manager's notification shows the progress.
 *
 * It takes these downloads before `onDownload` does. `onDownload`, or the core's external open when it is unset, still
 * gets `blob:` and `data:` downloads, and any download the Download Manager refuses, such as when it is disabled.
 *
 * The Download Manager fetches the file again with the page's cookies and user agent, so a download that needs a POST
 * or other headers fails.
 * @returns Null on iOS.
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
