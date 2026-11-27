import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

/**
 * A scroll, for {@link onScroll}, in points on iOS and dp on Android.
 * @group Events
 */
export type ScrollEvent = {
  contentOffset: { x: number; y: number };
  /**
   * The scroll view's own `contentInset` (iOS), without the automatic adjustment the offsets include. All 0 on
   * Android.
   */
  contentInset: { top: number; left: number; bottom: number; right: number };
  contentSize: { width: number; height: number };
  /** The WebView's own size. */
  layoutMeasurement: { width: number; height: number };
  /** @ios */
  zoomScale?: number;
};

/**
 * Calls `handler` on each change of the scroll offset, with no throttling.
 *
 * On iOS, the offsets include the content inset adjustment unless `ios.scrollView.contentInsetAdjustmentBehavior` is
 * `never`.
 * @group Extensions
 */
export const onScroll = (
  handler: (event: ScrollEvent) => void
): HookExtension<HookEvent<'scroll', ScrollEvent>> => ({
  key: '@react-native-minimal-webview/extensions.onScroll',
  onEvent: ({ payload }) => handler(payload),
});
