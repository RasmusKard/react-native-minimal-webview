import MinimalWebView
import WebKit

/// The hook behind `incognito()`: the WKWebView is created with a non-persistent data store.
enum Incognito {
  static let key = "@react-native-minimal-webview/extensions.incognito"

  static func register() {
    MinimalWebViewHooks.register(key, configure: { configuration, _ in
      configuration.websiteDataStore = .nonPersistent()
    }) { _, _ in }
  }
}
