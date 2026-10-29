import WebKit

/// The WKWebView's navigation and UI delegate. It implements only the observation callbacks the core doesn't, to give
/// them to every hook delegate; every other callback is forwarded to the core (MinimalWebView) or to a hook delegate,
/// by the rule in `WebViewContext`. `responds(to:)` says yes for whatever any of them implements, which WebKit reads
/// once, when the proxy is assigned as the delegate.
final class DelegateProxy: NSObject, WKNavigationDelegate, WKUIDelegate {
  private weak var core: NSObject?
  var navigationDelegates: [WKNavigationDelegate] = []
  var uiDelegates: [WKUIDelegate] = []

  init(core: NSObject) {
    self.core = core
  }

  /// The hook delegates for a callback: the list of the protocol that declares it. A selector neither protocol declares
  /// (a private one) goes to both lists.
  private func delegates(for selector: Selector) -> [NSObject] {
    let navigation = Self.declares(WKNavigationDelegate.self, selector)
    let ui = Self.declares(WKUIDelegate.self, selector)
    let lists: [[AnyObject]] =
      navigation == ui ? [navigationDelegates, uiDelegates] : navigation ? [navigationDelegates] : [uiDelegates]
    return lists.joined().compactMap { $0 as? NSObject }
  }

  private static func declares(_ proto: Protocol, _ selector: Selector) -> Bool {
    protocol_getMethodDescription(proto, selector, false, true).name != nil
      || protocol_getMethodDescription(proto, selector, true, true).name != nil
  }

  override func responds(to aSelector: Selector!) -> Bool {
    super.responds(to: aSelector) || core?.responds(to: aSelector) == true
      || delegates(for: aSelector).contains { $0.responds(to: aSelector) }
  }

  override func forwardingTarget(for aSelector: Selector!) -> Any? {
    let hook = delegates(for: aSelector).first { $0.responds(to: aSelector) }
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

  /// The action policy, a decision the first navigation delegate that implements either variant owns, else the core.
  /// WebKit calls only this variant once the delegate answers it, so the proxy answers it always and calls the owner's
  /// own variant, which makes the order of the list decide whichever variants the delegates implement.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    preferences: WKWebpagePreferences,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    let owner = delegates(for: Self.actionPolicy).first {
      $0.responds(to: Self.actionPolicy) || $0.responds(to: Self.actionPolicyWithPreferences)
    }
    if let owner, owner.responds(to: Self.actionPolicyWithPreferences) {
      (owner as? WKNavigationDelegate)?.webView?(
        webView, decidePolicyFor: navigationAction, preferences: preferences, decisionHandler: decisionHandler)
      return
    }
    guard let plain = (owner ?? core) as? WKNavigationDelegate else { return decisionHandler(.cancel, preferences) }
    plain.webView?(webView, decidePolicyFor: navigationAction) { decisionHandler($0, preferences) }
  }

  private static let actionPolicy = NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")
  private static let actionPolicyWithPreferences =
    NSSelectorFromString("webView:decidePolicyForNavigationAction:preferences:decisionHandler:")

  /// The decision callbacks the core implements: a hook delegate that implements one owns it. The action policy is
  /// not here: the proxy decides it above.
  private static let decisions = Set([
    "webView:decidePolicyForNavigationResponse:decisionHandler:",
    "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:",
    "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
    "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
    "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"
  ].map(NSSelectorFromString))
}
