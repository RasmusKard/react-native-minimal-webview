import { requireNativeModule } from 'expo';
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * The events of the sample page counter hook, for {@link pageCounter}'s `onEvent`. A native
 * `context.emit('pageLoaded', …)` arrives as `pageLoaded`:
 * - `pageLoaded`: each page load; the hook also stamps the count into the page's `window.__pageCount`.
 * - `redirect` (iOS): `didReceiveServerRedirectForProvisionalNavigation`; `commitVisible` (Android):
 *   `onPageCommitVisible`.
 * - `documentEnd`: from `context.onDocumentEnd`, with `context.url` as it was there.
 * - `label`: an ask, answered by `onEvent`'s return value.
 *
 * `ref.hook('sample.pageCounter', 'label')` resolves with the `label` answer, or rejects with `handler_error` when it
 * is null. `ref.hook('sample.pageCounter', 'count')` resolves with the count.
 */
export type PageCounterEvent =
  | HookEvent<'pageLoaded', { url: string; count: number }>
  | HookEvent<'redirect', { url: string }>
  | HookEvent<'commitVisible', { url: string }>
  | HookEvent<'documentEnd', { reason: 'committed' | 'crashed'; url: string }>
  | HookEvent<'label', { count: number }>;

/**
 * The page counter hook, for the `extensions` prop. `{ global: '__count' }` renames the page global it stamps.
 */
export const pageCounter = (
  options: true | { global: string } = true,
  onEvent?: (event: PageCounterEvent, signal?: AbortSignal) => unknown
): HookExtension<PageCounterEvent> => ({ key: 'sample.pageCounter', options, onEvent });

type SampleHookEvents = {
  hookAuth: HookEvent<'challenge', { method: string; host: string }>;
  hookDialogs: HookEvent<'alert', { message: string }>;
  seams: HookEvent<'download' | 'scrollA' | 'scrollB', Record<string, never>>;
  hookNavigation: HookEvent;
  subclass: HookEvent;
  perf: HookEvent;
  noWebView: HookEvent;
};

/**
 * One of the sample's hooks that take no options, for the `extensions` prop. A caller that wants its events sets
 * `onEvent` on the result.
 */
export const sampleHook = <N extends keyof SampleHookEvents>(
  name: N
): HookExtension<SampleHookEvents[N]> => ({ key: `sample.${name}` });

/**
 * The `sample.seams` hook's counter: how many of its WebViews were closed at unmount. Android: `setWebViewMissing`
 * makes the `sample.noWebView` hook's factory throw, as WebView's constructor does without a WebView provider. iOS:
 * `tapAlert` presses a button of the alert on screen as a tap does, and is false when there is none.
 */
export const seams = requireNativeModule<{
  closedViews(): Promise<number>;
  setWebViewMissing(missing: boolean): Promise<void>;
  tapAlert(title: string): Promise<boolean>;
}>('SampleExtension');
