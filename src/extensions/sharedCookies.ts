import type { WebViewExtension } from '../types';

/**
 * iOS: copies HTTPCookieStorage (native requests) into the WebView when it is created, and the WebView's cookies back
 * after each page load. Android needs nothing: CookieManager is shared app-wide (flushed when the app backgrounds).
 */
export const sharedCookies = (): WebViewExtension => ({ native: { name: 'sharedCookies' } });
