import MinimalWebView
import WebKit

enum Incognito {
  static let key = "@react-native-minimal-webview/extensions.incognito"

  static func register() {
    MinimalWebViewHooks.register(key, configure: { configuration, _ in
      configuration.websiteDataStore = .nonPersistent()
    }) { _, _ in }
  }
}
