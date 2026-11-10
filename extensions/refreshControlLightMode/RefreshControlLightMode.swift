import MinimalWebView
import UIKit

/// The hook behind `refreshControlLightMode()`: the refresh control's tint is white, and inherited again when it is off.
enum RefreshControlLightMode {
  static let key = "@react-native-minimal-webview/extensions.refreshControlLightMode"

  static func register() {
    MinimalWebViewHooks.register(key) { _, context in
      context.onOptions { [weak context] options in context?.refreshControl?.tintColor = options != nil ? .white : nil }
    }
  }
}
