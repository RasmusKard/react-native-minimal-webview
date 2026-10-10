import type { WebViewExtension } from '../types';

/**
 * A finished download: `uri` is a `file://` in the app's cache (iOS: the temporary directory). `url` is the server URL
 * the file came from; `null` when the page generated it (`data:` or `blob:` URL).
 */
export type Download = { uri: string; filename: string; mimeType: string; url: string | null };

/**
 * A download that could not be saved (a bad data: or blob: URL, a network or HTTP error). `url` as in {@link Download}.
 */
export type DownloadFailure = { filename: string; url: string | null; reason: string };

/**
 * Downloads keep the page's session: WKDownload on iOS, a fetch with the page's cookies and user agent on Android. The
 * file lands in the app's cache; the app opens, saves or shares it in `onDownload`.
 */
export const downloads = (
  options: {
    onDownload?: (download: Download) => void;
    onError?: (failure: DownloadFailure) => void;
  } = {}
): WebViewExtension => ({
  native: { name: 'downloads' },
  on: { download: options.onDownload, downloadFailed: options.onError },
});
