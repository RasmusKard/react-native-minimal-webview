import MinimalWebView
import WebKit

/// The hook behind `onScroll()`: each change of the scroll view's offset, as react-native-webview's event.
enum OnScroll {
  static let key = "@react-native-minimal-webview/extensions.onScroll"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      // KVO, only while the hook is on: the scroll view's delegate is WebKit's.
      var observation: NSKeyValueObservation?
      context.onOptions { [weak webView] options in
        if options == nil {
          observation = nil
        } else if observation == nil {
          observation = webView?.scrollView.observe(\.contentOffset) { scrollView, _ in
            context.emit("scroll", event(scrollView))
          }
        }
      }
      context.onDestroyed { _ in observation = nil }
    }
  }

  private static func event(_ view: UIScrollView) -> [String: Any] {
    let inset = view.contentInset
    return [
      "contentOffset": ["x": Double(view.contentOffset.x), "y": Double(view.contentOffset.y)],
      "contentInset": [
        "top": Double(inset.top), "left": Double(inset.left), "bottom": Double(inset.bottom), "right": Double(inset.right)
      ],
      "contentSize": ["width": Double(view.contentSize.width), "height": Double(view.contentSize.height)],
      "layoutMeasurement": ["width": Double(view.frame.width), "height": Double(view.frame.height)],
      "zoomScale": Double(view.zoomScale)
    ]
  }
}
