import MinimalWebView
import WebKit

/// The hook behind the `onScroll` prop: each change of the scroll view's offset, as react-native-webview's event.
enum OnScroll {
  static let key = "@minimal-rn-webview/extensions.onScroll"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      // KVO: the scroll view's delegate is WebKit's.
      let observation = webView.scrollView.observe(\.contentOffset) { [weak context] scrollView, _ in
        guard let context, context.options != nil else { return }
        context.emit("scroll", event(scrollView))
      }
      return { observation.invalidate() }
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
