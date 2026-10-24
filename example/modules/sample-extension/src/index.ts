import type { HookEvent } from 'minimal-rn-webview';

/**
 * The events the sample module's page counter sends, once a WebView enables it with
 * `hookOptions={{ 'sample.pageCounter': true }}` (or `{ global: '__count' }` as the value to name the page's global):
 * on each page load it stamps `window.__pageCount` and emits `pageLoaded`; `redirect` (iOS) and `commitVisible`
 * (Android) come from a delegate callback the core doesn't implement itself; `documentEnd` from `context.onDocumentEnd`,
 * with `context.url` there. `ref.hook('sample.pageCounter', 'count')` resolves with the count, and
 * `ref.hook('sample.pageCounter', 'label')` with the app's answer to the `label` ask (`onHookEvent`'s return value).
 */
export type PageCounterEvent =
  | HookEvent<'sample.pageCounter.pageLoaded', { url: string; count: number }>
  | HookEvent<'sample.pageCounter.redirect', { url: string }>
  | HookEvent<'sample.pageCounter.commitVisible', { url: string }>
  | HookEvent<'sample.pageCounter.documentEnd', { reason: 'committed' | 'crashed'; url: string }>
  | HookEvent<'sample.pageCounter.label', { count: number }>;

export const isPageCounterEvent = (event: HookEvent): event is PageCounterEvent =>
  event.name.startsWith('sample.pageCounter.');
