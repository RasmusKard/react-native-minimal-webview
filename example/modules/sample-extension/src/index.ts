import type { HookEvent } from 'minimal-rn-webview';

/**
 * The events the sample module's page counter sends, once a WebView enables it with
 * `hookOptions={{ pageCounter: true }}` (or `{ pageCounter: { global: '__count' } }` to name the page's global): on
 * each page load it stamps `window.__pageCount` and emits `pageLoaded`; `redirect` (iOS) and `commitVisible`
 * (Android) come from a delegate callback the core doesn't implement itself; `documentEnd` from `context.onDocumentEnd`.
 * `ref.hook('pageCounter', 'count')` resolves with the count.
 */
export type PageCounterEvent =
  | HookEvent<'pageCounter.pageLoaded', { url: string; count: number }>
  | HookEvent<'pageCounter.redirect', { url: string }>
  | HookEvent<'pageCounter.commitVisible', { url: string }>
  | HookEvent<'pageCounter.documentEnd', { reason: 'committed' | 'crashed' }>;

export const isPageCounterEvent = (event: HookEvent): event is PageCounterEvent =>
  event.name.startsWith('pageCounter.');
