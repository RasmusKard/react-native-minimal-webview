import MinimalWebView
import WebKit

/// The hook behind `googleMobileAds()`.
enum GoogleMobileAds {
  static let key = "@react-native-minimal-webview/extensions.googleMobileAds"
  private static let registerWebView = NSSelectorFromString("registerWebView:")

  static func register() {
    MinimalWebViewHooks.register(key, configure: newWebViewsOnly) { webView, context in
      guard let mobileAds = (NSClassFromString("GADMobileAds") as? NSObject.Type)?.value(forKey: "sharedInstance") as? NSObject,
        mobileAds.responds(to: registerWebView)
      else { return context.emit("sdkMissing", [:]) }
      mobileAds.perform(registerWebView, with: webView)
    }
  }

  private static let newWebViewsOnly: (WKWebViewConfiguration, WebViewContext) -> Void = { _, _ in }
}
