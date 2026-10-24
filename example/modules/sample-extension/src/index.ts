import type { HookEvent } from 'minimal-rn-webview';

/**
 * The events of the sample page counter hook, which a WebView turns on with
 * `hookOptions={{ 'sample.pageCounter': true }}` (or `{ global: '__count' }` as the value, to rename the page global it
 * stamps). A native `context.emit('pageLoaded', …)` arrives in `onHookEvent` as `sample.pageCounter.pageLoaded`:
 * - `pageLoaded`: each page load; the hook also stamps the count into the page's `window.__pageCount`.
 * - `redirect` (iOS) and `commitVisible` (Android): delegate callbacks the core doesn't implement itself.
 * - `documentEnd`: from `context.onDocumentEnd`, with `context.url` as it was there.
 * - `label`: an ask, answered by `onHookEvent`'s return value. `ref.hook('sample.pageCounter', 'label')` resolves with
 *   that answer, and `ref.hook('sample.pageCounter', 'count')` with the count.
 */
export type PageCounterEvent =
  | HookEvent<'sample.pageCounter.pageLoaded', { url: string; count: number }>
  | HookEvent<'sample.pageCounter.redirect', { url: string }>
  | HookEvent<'sample.pageCounter.commitVisible', { url: string }>
  | HookEvent<'sample.pageCounter.documentEnd', { reason: 'committed' | 'crashed'; url: string }>
  | HookEvent<'sample.pageCounter.label', { count: number }>;

export const isPageCounterEvent = (event: HookEvent): event is PageCounterEvent =>
  event.name.startsWith('sample.pageCounter.');
