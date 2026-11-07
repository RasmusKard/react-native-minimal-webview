import WebKit

/// The WKWebView's navigation and UI delegate. It implements the observation callbacks the core doesn't, to give them
/// to every hook delegate, and the authentication challenge, to offer it to each in turn; every other callback is
/// forwarded to the core (MinimalWebView) or to a hook delegate, by the rule in `WebViewContext`. `responds(to:)` says
/// yes for whatever any of them implements, which WebKit reads once, when the proxy is assigned as the delegate.
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

  /// An authentication challenge, offered to each navigation delegate that implements it, in order, until one answers
  /// other than `.performDefaultHandling`; WebKit's default handling when none does.
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
    guard let taker = takers.first else { return completionHandler(.performDefaultHandling, nil) }
    taker.webView?(webView, didReceive: challenge) { disposition, credential in
      guard disposition == .performDefaultHandling else { return completionHandler(disposition, credential) }
      offer(challenge, webView, takers.dropFirst(), completionHandler)
    }
  }

  private static let challenge = NSSelectorFromString("webView:didReceiveAuthenticationChallenge:completionHandler:")

  /// The action policy, a decision the first navigation delegate that implements either variant owns, else the core.
  /// WebKit calls only this variant once the delegate answers it, so the proxy answers it always and calls the owner's
  /// own variant, which makes the order of the list decide whichever variants the delegates implement.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    preferences: WKWebpagePreferences,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    let owner = takers(of: Self.actionPolicy).first
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

  /// The hook delegates that implement a decision, in order: the first one takes it. Either action policy variant
  /// counts as the action policy.
  private func takers(of decision: Selector) -> [NSObject] {
    delegates(for: decision).filter {
      $0.responds(to: decision) || decision == Self.actionPolicy && $0.responds(to: Self.actionPolicyWithPreferences)
    }
  }

  /// The decision callbacks more than one hook delegate implements, by selector name: only the first one gets each.
  var sharedDecisions: [String] {
    ([Self.actionPolicy] + Self.decisions).filter { takers(of: $0).count > 1 }.map(NSStringFromSelector)
  }

  /// The decisions a hook delegate takes that the core makes from the app's props or their defaults: each one's
  /// selector name and what stops applying.
  var takenDecisions: [(name: String, lost: String)] {
    Self.fromProps.filter { !takers(of: $0.0).isEmpty }.map { (NSStringFromSelector($0.0), $0.1) }
  }

  private static let navigationResponse = NSSelectorFromString("webView:decidePolicyForNavigationResponse:decisionHandler:")
  private static let newWindow =
    NSSelectorFromString("webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:")
  private static let mediaCapture =
    NSSelectorFromString("webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:")

  private static let fromProps: [(Selector, String)] = [
    (actionPolicy, "navigationRules, their defaults and onNavigationRequest don't apply to navigations"),
    (navigationResponse, "onDownload, opening downloads externally and onError's http errors don't apply"),
    (newWindow, "navigationRules, their defaults and onNavigationRequest don't apply to new windows"),
    (mediaCapture, "onPermissionRequest and the core's subframe deny don't apply")
  ]

  /// The decision callbacks the core implements: a hook delegate that implements one owns it. The action policy is
  /// not here: the proxy decides it above.
  private static let decisions = [
    navigationResponse,
    newWindow,
    NSSelectorFromString("webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:"),
    NSSelectorFromString("webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:"),
    NSSelectorFromString("webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:"),
    mediaCapture
  ]
}

/// `keys` in the order of the `registered` hook keys, then the keys no hook is registered under, sorted: hooks whose keys
/// turn on together attach in registration order, which orders their delegates.
func inRegistrationOrder(_ keys: Set<String>, _ registered: [String]) -> [String] {
  registered.filter(keys.contains) + keys.subtracting(registered).sorted()
}

/// Whether a `hookOptions` change leaves the hook on with the same value, so its hook has nothing to hear. Both values
/// must be on, and equal as JSON: `NSNumber(false).isEqual(NSNumber(0))` is true, at any depth, as Android's isn't.
func staysOn(_ was: Any?, _ value: Any?) -> Bool {
  guard let was, let value else { return false }
  let json = { (value: Any) in try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) }
  return json(was).map { $0 == json(value) } ?? false
}
