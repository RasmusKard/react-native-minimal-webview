import MinimalWebView
import WebKit

/// The hook behind `basicAuthCredential()`; its value is the credential.
enum BasicAuthCredential {
  static let key = "@react-native-minimal-webview/extensions.basicAuthCredential"

  static func register() {
    MinimalWebViewHooks.register(key) { _, context in
      context.navigationDelegates.append(Delegate(context))
    }
  }

  private final class Delegate: NSObject, WKNavigationDelegate {
    private let context: WebViewContext

    init(_ context: WebViewContext) {
      self.context = context
    }

    func webView(
      _ webView: WKWebView,
      didReceive challenge: URLAuthenticationChallenge,
      completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
      guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodHTTPBasic,
        challenge.previousFailureCount == 0, let credential = context.options as? [String: Any],
        let user = credential["username"] as? String, let password = credential["password"] as? String
      else { return completionHandler(.performDefaultHandling, nil) }
      completionHandler(.useCredential, URLCredential(user: user, password: password, persistence: .forSession))
    }
  }
}
