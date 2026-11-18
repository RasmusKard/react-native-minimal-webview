import MinimalWebView
import UIKit
import WebKit

/// The hook behind `removeIosKeyboardObserver()`, as react-native-webview does.
/// WebKit adds the observers only when it creates the view, so nothing adds them back.
enum RemoveIosKeyboardObserver {
  static let key = "@react-native-minimal-webview/extensions.removeIosKeyboardObserver"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, _ in
      let names = [
        UIResponder.keyboardWillHideNotification, UIResponder.keyboardWillShowNotification,
        UIResponder.keyboardWillChangeFrameNotification
      ]
      names.forEach { NotificationCenter.default.removeObserver(webView, name: $0, object: nil) }
    }
  }
}
