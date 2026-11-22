import WebKit

final class DelegateProxy: NSObject, WKNavigationDelegate, WKUIDelegate {
  private weak var core: NSObject?
  var navigationDelegates: [WKNavigationDelegate] = []
  var uiDelegates: [WKUIDelegate] = []
  var hookDecides: (WKNavigationAction) -> Void = { _ in }

  init(core: NSObject) {
    self.core = core
  }

  private func delegates(for selector: Selector) -> [NSObject] {
    let navigation = Self.declares(WKNavigationDelegate.self, selector)
    let ui = Self.declares(WKUIDelegate.self, selector)
    let neither = !navigation && !ui
    var delegates: [AnyObject] = []
    if navigation || neither { delegates += navigationDelegates as [AnyObject] }
    if ui || neither { delegates += uiDelegates as [AnyObject] }
    return delegates.compactMap { $0 as? NSObject }
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
    if Self.decisions.contains(where: { $0.selector == aSelector }), let hook { return hook }
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

  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let takers = navigationDelegates.filter { ($0 as? NSObject)?.responds(to: Self.challenge) == true }
    Self.offer(challenge, webView, takers[...], completionHandler)
  }

  private static func offer(
    _ challenge: URLAuthenticationChallenge,
    _ webView: WKWebView,
    _ takers: ArraySlice<WKNavigationDelegate>,
    _ completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let taker = takers.first else {
      // WebKit's default handling sends a rejected credential again, and again on each rejection.
      return completionHandler(challenge.previousFailureCount > 0 ? .rejectProtectionSpace : .performDefaultHandling, nil)
    }
    taker.webView?(webView, didReceive: challenge) { disposition, credential in
      guard disposition == .performDefaultHandling else { return completionHandler(disposition, credential) }
      offer(challenge, webView, takers.dropFirst(), completionHandler)
    }
  }

  private static let challenge = NSSelectorFromString("webView:didReceiveAuthenticationChallenge:completionHandler:")

  /// WebKit calls only this variant when the delegate implements it: the proxy always does, and calls the owner's own.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    preferences: WKWebpagePreferences,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    let owner = takers(of: Self.actionPolicy).first
    if owner != nil { hookDecides(navigationAction) }
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

  private func takers(of decision: Selector) -> [NSObject] {
    delegates(for: decision).filter {
      $0.responds(to: decision) || decision == Self.actionPolicy && $0.responds(to: Self.actionPolicyWithPreferences)
    }
  }

  func newWarnings() -> [String] {
    Self.decisions.flatMap { decision, lost in
      let name = NSStringFromSelector(decision)
      let takers = takers(of: decision).count
      return [
        takers > 1 ? "\(name): more than one hook delegate implements it; only the first one gets it" : nil,
        takers > 0 ? lost.map { "\(name): a hook delegate takes it, so \($0)" } : nil
      ].compactMap { $0 }.filter { warned.insert($0).inserted }
    }
  }

  private var warned: Set<String> = []

  private static let decisions: [(selector: Selector, lost: String?)] = [
    (actionPolicy, "navigationRules, their defaults and onNavigationRequest don't apply to navigations"),
    (
      NSSelectorFromString("webView:decidePolicyForNavigationResponse:decisionHandler:"),
      "onDownload, opening downloads externally and onError's http errors don't apply"
    ),
    (
      NSSelectorFromString("webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:"),
      "navigationRules, their defaults and onNavigationRequest don't apply to new windows"
    ),
    (NSSelectorFromString("webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:"), nil),
    (NSSelectorFromString("webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:"), nil),
    (NSSelectorFromString("webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:"), nil),
    (
      NSSelectorFromString("webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"),
      "onPermissionRequest and the core's subframe deny don't apply"
    )
  ]
}

func inRegistrationOrder(_ keys: Set<String>, _ registered: [String]) -> [String] {
  registered.filter(keys.contains) + keys.subtracting(registered).sorted()
}

/// `NSNumber(false).isEqual(NSNumber(0))` is true, so the values compare as JSON.
func staysOn(_ was: Any?, _ value: Any?) -> Bool {
  guard let was, let value else { return false }
  let json = { (value: Any) in try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) }
  return json(was).map { $0 == json(value) } ?? false
}
