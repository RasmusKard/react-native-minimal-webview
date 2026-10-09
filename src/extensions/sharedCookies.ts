import type { WebViewExtension } from '../types';

/**
 * iOS: copies HTTPCookieStorage (native requests) into the WebView before each `source` load (the first load waits for
 * it), and the WebView's cookie changes back as they happen. Android needs nothing: CookieManager is shared app-wide
 * (flushed when the app backgrounds).
 */
export const sharedCookies = (): WebViewExtension => ({ native: { name: 'sharedCookies' } });
