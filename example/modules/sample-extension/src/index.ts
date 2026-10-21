import type { NativeEvent } from 'minimal-rn-webview';

/**
 * The events the sample module's page counter sends, once a WebView enables it with
 * `nativeOptions={{ pageCounter: true }}` (or `{ pageCounter: { global: '__count' } }` to name the page's global): on
 * each page load it stamps `window.__pageCount` and emits `pageLoaded`; `redirect` (iOS) and `commitVisible`
 * (Android) come from a delegate callback the core doesn't implement itself; `documentEnd` from `context.onDocumentEnd`.
 * `ref.hook('pageCounter', 'count')` resolves with the count.
 */
export type PageCounterEvent =
  | { name: 'pageCounter.pageLoaded'; payload: { url: string; count: number } }
  | { name: 'pageCounter.redirect'; payload: { url: string } }
  | { name: 'pageCounter.commitVisible'; payload: { url: string } }
  | { name: 'pageCounter.documentEnd'; payload: { reason: 'committed' | 'crashed' } };

export const isPageCounterEvent = (event: NativeEvent): event is PageCounterEvent =>
  event.name.startsWith('pageCounter.');
