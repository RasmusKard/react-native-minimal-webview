import WebKit

/// The WKWebView's navigation and UI delegate. It implements no callback itself: each is forwarded to the core
/// (MinimalWebView) or to a hook delegate, by the rule in `WebViewContext`. `responds(to:)` says yes for whatever any
/// of them implements, which WebKit reads once, when the proxy is assigned as the delegate.
final class DelegateProxy: NSObject, WKNavigationDelegate, WKUIDelegate {
  private unowned let core: MinimalWebView
  var navigationDelegates: [WKNavigationDelegate] = []
  var uiDelegates: [WKUIDelegate] = []

  init(core: MinimalWebView) {
    self.core = core
  }

  private var delegates: [NSObject] {
    (navigationDelegates as [AnyObject] + uiDelegates).compactMap { $0 as? NSObject }
  }

  override func responds(to aSelector: Selector!) -> Bool {
    super.responds(to: aSelector) || core.responds(to: aSelector) || delegates.contains { $0.responds(to: aSelector) }
  }

  override func forwardingTarget(for aSelector: Selector!) -> Any? {
    let hook = delegates.first { $0.responds(to: aSelector) }
    if Self.decisions.contains(aSelector), let hook { return hook }
    if core.responds(to: aSelector) { return core }
    return hook ?? super.forwardingTarget(for: aSelector)
  }

  /// The decision callbacks the core implements: a hook delegate that implements one owns it.
  private static let decisions = Set([
    "webView:decidePolicyForNavigationAction:decisionHandler:",
    "webView:decidePolicyForNavigationResponse:decisionHandler:",
    "webView:didReceiveAuthenticationChallenge:completionHandler:",
    "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:",
    "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
    "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"
  ].map(NSSelectorFromString))
}
