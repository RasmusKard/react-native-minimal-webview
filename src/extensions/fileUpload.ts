import type { WebViewExtension } from '../types';

export type FileRequest = { accept: string[]; multiple: boolean; capture: boolean };

/**
 * `<input type="file">` on Android: `onFileRequest` picks files (e.g. with expo-document-picker or expo-image-picker)
 * and returns their URIs, or null to cancel. iOS uses WebKit's own picker.
 */
export const fileUpload = (options: {
  onFileRequest: (request: FileRequest) => Promise<string[] | null> | string[] | null;
}): WebViewExtension => ({
  native: { name: 'fileUpload' },
  onEvent: (event, payload) =>
    event === 'fileRequest' ? options.onFileRequest(payload as FileRequest) : undefined,
});
