import type { WebViewExtension } from '../types';

/** A finished download: `uri` is a local file (iOS, Android data:/blob:) or a content:// URI (Android DownloadManager). */
export type Download = { uri: string; filename: string; mimeType: string; url: string | null };

/**
 * Downloads keep the page's session and cookies: WKDownload on iOS (into the temporary directory), DownloadManager on
 * Android (public Downloads, with a system notification). The app shares or moves the file in `onDownload`.
 */
export type DownloadFailure = { filename: string; url: string | null; reason: string };

export const downloads = (
  options: { onDownload?: (download: Download) => void; onError?: (failure: DownloadFailure) => void } = {}
): WebViewExtension => ({
  native: { name: 'downloads' },
  onEvent: (event, payload) => {
    if (event === 'download') options.onDownload?.(payload as Download);
    if (event === 'downloadFailed') options.onError?.(payload as DownloadFailure);
  },
});
