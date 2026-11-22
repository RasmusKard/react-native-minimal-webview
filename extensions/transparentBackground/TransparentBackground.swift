import MinimalWebView
import WebKit

enum TransparentBackground {
  static let key = "@react-native-minimal-webview/extensions.transparentBackground"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      // WebKit clears its scroll view's background itself while the WKWebView isn't opaque.
      let opaque = webView.isOpaque
      context.onOptions { [weak webView] options in webView?.isOpaque = options == nil && opaque }
    }
  }
}
