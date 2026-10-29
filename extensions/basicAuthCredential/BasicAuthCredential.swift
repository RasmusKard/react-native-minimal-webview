import MinimalWebView
import WebKit

/// The hook behind `basicAuthCredential()`; its value is the credential.
enum BasicAuthCredential {
  static let key = "@react-native-minimal-webview/extensions.basicAuthCredential"

  static func register() {
    MinimalWebViewHooks.register(key) { _, context in
      let delegate = Delegate(context)
      // A listed delegate answers every challenge: listed only while it is on, so the core declines them again.
      let list = { [weak context] (on: Bool) in
        context?.navigationDelegates.removeAll { $0 === delegate }
        if on { context?.navigationDelegates.append(delegate) }
      }
      list(true)
      context.onOptionsChange { list($0 != nil) }
      return nil
    }
  }

  private final class Delegate: NSObject, WKNavigationDelegate {
    // Weak: the context holds the handler that holds this delegate.
    private weak var context: WebViewContext?

    init(_ context: WebViewContext) {
      self.context = context
    }

    func webView(
      _ webView: WKWebView,
      didReceive challenge: URLAuthenticationChallenge,
      completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
      // A credential the site rejected is not sent again: it would be rejected again, and the load would never end.
      guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodHTTPBasic,
        challenge.previousFailureCount == 0, let credential = context?.options as? [String: Any],
        let user = credential["username"] as? String, let password = credential["password"] as? String
      else { return completionHandler(.performDefaultHandling, nil) }
      // WebKit doesn't use a credential with no persistence for a page load: the session keeps it.
      completionHandler(.useCredential, URLCredential(user: user, password: password, persistence: .forSession))
    }
  }
}
