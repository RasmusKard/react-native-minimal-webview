import MinimalWebView
import WebKit

/// The hook behind `transparentBackground()`: the WKWebView isn't opaque, and gets back the opacity it had when it is
/// switched off. WebKit clears its scroll view's background itself while the WKWebView isn't opaque.
enum TransparentBackground {
  static let key = "@react-native-minimal-webview/extensions.transparentBackground"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      let opaque = webView.isOpaque
      let apply = { [weak webView] in webView?.isOpaque = context.options == nil && opaque }
      apply()
      context.onOptionsChange { _ in apply() }
    }
  }
}
