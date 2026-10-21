import WebKit

/// The WKWebView's navigation and UI delegate. It implements only the observation callbacks the core doesn't, to give
/// them to every hook delegate; every other callback is forwarded to the core (MinimalWebView) or to a hook delegate,
/// by the rule in `WebViewContext`. `responds(to:)` says yes for whatever any of them implements, which WebKit reads
/// once, when the proxy is assigned as the delegate.
final class DelegateProxy: NSObject, WKNavigationDelegate, WKUIDelegate {
  private weak var core: MinimalWebView?
  var navigationDelegates: [WKNavigationDelegate] = []
  var uiDelegates: [WKUIDelegate] = []

  init(core: MinimalWebView) {
    self.core = core
  }

  private var delegates: [NSObject] {
    (navigationDelegates as [AnyObject] + uiDelegates).compactMap { $0 as? NSObject }
  }

  override func responds(to aSelector: Selector!) -> Bool {
    super.responds(to: aSelector) || core?.responds(to: aSelector) == true || delegates.contains { $0.responds(to: aSelector) }
  }

  override func forwardingTarget(for aSelector: Selector!) -> Any? {
    let hook = delegates.first { $0.responds(to: aSelector) }
    if Self.decisions.contains(aSelector), let hook { return hook }
    if let core, core.responds(to: aSelector) { return core }
    return hook ?? super.forwardingTarget(for: aSelector)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    navigationDelegates.forEach { $0.webView?(webView, didStartProvisionalNavigation: navigation) }
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    navigationDelegates.forEach { $0.webView?(webView, didReceiveServerRedirectForProvisionalNavigation: navigation) }
  }

  func webViewDidClose(_ webView: WKWebView) {
    uiDelegates.forEach { $0.webViewDidClose?(webView) }
  }

  /// The decision callbacks the core implements: a hook delegate that implements one owns it.
  private static let decisions = Set([
    "webView:decidePolicyForNavigationAction:decisionHandler:",
    "webView:decidePolicyForNavigationResponse:decisionHandler:",
    "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:",
    "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
    "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"
  ].map(NSSelectorFromString))
}
