import type { HookExtension } from 'minimal-rn-webview';

/**
 * A scroll, for {@link onScroll}: react-native-webview's event, in points (iOS) or dp (Android).
 * @group Events
 */
export type ScrollEvent = {
  nativeEvent: {
    contentOffset: { x: number; y: number };
    /** All 0 on Android. */
    contentInset: { top: number; left: number; bottom: number; right: number };
    contentSize: { width: number; height: number };
    /** The WebView's own size. */
    layoutMeasurement: { width: number; height: number };
    /** @ios */
    zoomScale?: number;
  };
};

/**
 * Calls `handler` on each change of the scroll offset, with no throttling: react-native-webview's `onScroll`.
 *
 * On iOS, the offsets include the content inset adjustment unless `ios.scrollView.contentInsetAdjustmentBehavior` is
 * `never`, react-native-webview's default.
 * @group Extensions
 */
export const onScroll = (handler: (event: ScrollEvent) => void): HookExtension => ({
  key: '@minimal-rn-webview/extensions.onScroll',
  options: true,
  onEvent: ({ payload }) => handler({ nativeEvent: payload as ScrollEvent['nativeEvent'] }),
});
