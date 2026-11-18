import MinimalWebView
import UIKit

/// The hook behind `refreshControlLightMode()`.
enum RefreshControlLightMode {
  static let key = "@react-native-minimal-webview/extensions.refreshControlLightMode"

  static func register() {
    MinimalWebViewHooks.register(key) { _, context in
      context.onOptions { [weak context] options in context?.refreshControl?.tintColor = options != nil ? .white : nil }
    }
  }
}
