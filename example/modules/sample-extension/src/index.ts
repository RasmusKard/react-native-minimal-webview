import { requireNativeModule } from 'expo';
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * The events of the sample page counter hook, for {@link pageCounter}'s `onEvent`. A native
 * `context.emit('pageLoaded', …)` arrives as `sample.pageCounter.pageLoaded`:
 * - `pageLoaded`: each page load; the hook also stamps the count into the page's `window.__pageCount`.
 * - `redirect` (iOS) and `commitVisible` (Android): delegate callbacks the core doesn't implement itself.
 * - `documentEnd`: from `context.onDocumentEnd`, with `context.url` as it was there.
 * - `label`: an ask, answered by `onEvent`'s return value. `ref.hook('sample.pageCounter', 'label')` resolves with
 *   that answer, and `ref.hook('sample.pageCounter', 'count')` with the count.
 */
export type PageCounterEvent =
  | HookEvent<'sample.pageCounter.pageLoaded', { url: string; count: number }>
  | HookEvent<'sample.pageCounter.redirect', { url: string }>
  | HookEvent<'sample.pageCounter.commitVisible', { url: string }>
  | HookEvent<'sample.pageCounter.documentEnd', { reason: 'committed' | 'crashed'; url: string }>
  | HookEvent<'sample.pageCounter.label', { count: number }>;

/**
 * The page counter hook, for `useExtensions`. `{ global: '__count' }` renames the page global it stamps.
 */
export const pageCounter = (
  options: true | { global: string } = true,
  onEvent?: (event: PageCounterEvent, signal?: AbortSignal) => unknown
): HookExtension => ({
  key: 'sample.pageCounter',
  options,
  // Only this hook's events reach it, and they are its PageCounterEvents.
  onEvent: onEvent && ((event, signal) => onEvent(event as PageCounterEvent, signal)),
});

/**
 * One of the sample's hooks that take no options and send their events to the app's `onHookEvent`, for
 * `useExtensions`.
 */
export const sampleHook = (
  name: 'hookAuth' | 'hookDialogs' | 'hookNavigation' | 'subclass' | 'seams' | 'perf'
): HookExtension => ({ key: `sample.${name}`, options: true });

/** The `sample.seams` hook's counter (Android): how many of its WebViews were destroyed at unmount. */
export const seams = requireNativeModule<{ closedViews(): Promise<number> }>('SampleExtension');
