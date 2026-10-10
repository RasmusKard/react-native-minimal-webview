import UIKit
import WebKit

/// Navigation rules, `ask`, new windows and external opening. The decision handler is held while JS answers an
/// `ask`, called exactly once, and blocked after 1 s or when the WebView goes away.
extension MinimalWebView {
  func decideNavigation(_ action: WKNavigationAction, in webView: WKWebView, decide: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    guard let target = action.request.url else { return decide(.allow) }
    // New windows are decided in createWebViewWith; history steps, reloads and our own loads skip the rules,
    // as on Android (shouldOverrideUrlLoading is not called for them).
    if action.targetFrame == nil { return decide(.allow) }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    let own = mainFrame && programmaticUrl.map { Self.sameURL($0, target) } == true
    if own || action.navigationType == .backForward || action.navigationType == .reload {
      if own { programmaticUrl = nil }
      expectNavigation(action, from: webView)
      return decide(.allow)
    }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: mainFrame, newWindow: false, userInitiated: action.navigationType == .linkActivated
    )
    let download = activeExtensions?.contains { $0.wantsDownload(action) } == true
    run(request) { [weak self] allowed in
      if allowed && !download { self?.expectNavigation(action, from: webView) }
      decide(allowed ? (download ? .download : .allow) : .cancel)
    }
  }

  private func expectNavigation(_ action: WKNavigationAction, from webView: WKWebView) {
    if action.targetFrame?.isMainFrame == true, !Self.isFragmentOnly(action.request.url, from: webView.url) {
      navigationExpected = true
      expireExpectedNavigation()
    }
  }

  /// window.open and target=_blank: never a second WKWebView. `allow` loads the URL in this one.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let target = action.request.url, !target.absoluteString.isEmpty, target.absoluteString != "about:blank" else { return nil }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: true, newWindow: true, userInitiated: action.navigationType == .linkActivated
    )
    run(request) { [weak self] allowed in
      guard allowed, let self else { return }
      self.programmaticUrl = target
      self.webView?.load(action.request)
    }
    return nil
  }

  /// Applies the rules (and `ask`) to a request and reports the outcome; `completion` gets whether to load it here.
  private func run(_ request: NavigationRules.Request, completion: @escaping (Bool) -> Void) {
    let decision = NavigationRules.decide(navigationRules, request)
    // A URL an `ask` allowed is not asked again until the next main-frame commit (redirect loops).
    if decision.action == "ask", askedAndAllowed.contains(request.url) {
      finish(request, "allow", decision.rule, completion)
      return
    }
    guard decision.action == "ask" else {
      finish(request, decision.action, decision.rule, completion)
      return
    }
    let id = register { [weak self] answer in
      // The view can be gone (teardown flushes pending asks from deinit): the decision handler must still be called.
      guard let self else { return completion(false) }
      let action = answer as? String ?? "block"
      if action == "allow" { self.askedAndAllowed.insert(request.url) }
      self.finish(request, ["allow", "block", "external"].contains(action) ? action : "block", decision.rule, completion)
    }
    onNavigationRequest([
      "id": id, "url": request.url, "mainFrame": request.mainFrame, "newWindow": request.newWindow,
      "userInitiated": request.userInitiated
    ])
    // Unanswered after the timeout: block.
    DispatchQueue.main.asyncAfter(deadline: .now() + askTimeout) { [weak self] in
      self?.pendingAsks.removeValue(forKey: id)?(nil)
    }
  }

  private func finish(_ request: NavigationRules.Request, _ action: String, _ rule: Int?, _ completion: (Bool) -> Void) {
    if action == "external", let url = URL(string: request.url) { openExternal(url) }
    onNavigation([
      "url": request.url, "action": action, "mainFrame": request.mainFrame, "newWindow": request.newWindow,
      "userInitiated": request.userInitiated, "rule": rule as Any? ?? NSNull()
    ])
    completion(action == "allow")
  }

  private func openExternal(_ url: URL) {
    guard !openExternalInJS else { return }
    UIApplication.shared.open(url)
  }

  func register(_ onAnswer: @escaping (Any?) -> Void) -> Int {
    nextAskId += 1
    pendingAsks[nextAskId] = onAnswer
    return nextAskId
  }

  /// The generic channel from JS: answers to any `ask`. (iOS extensions take no calls yet.)
  func extensionCall(_ name: String, _ method: String, _ args: [String: Any]) -> Any? {
    // JS numbers arrive as Double.
    if method == "__answer", let id = (args["askId"] as? NSNumber)?.intValue {
      pendingAsks.removeValue(forKey: id)?(args["value"] is NSNull ? nil : args["value"])
    }
    return nil
  }

  /// Answers every pending ask with nil (block): the WebView or its page is going away.
  func failPendingAsks() {
    let waiting = pendingAsks.values
    pendingAsks.removeAll()
    waiting.forEach { $0(nil) }
  }

  /// Equal URLs, treating an empty path as "/": WebKit turns `https://example.com` into `https://example.com/`.
  private static func sameURL(_ a: URL, _ b: URL) -> Bool {
    func normalized(_ url: URL) -> String? {
      guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
      if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
      return components.string
    }
    return normalized(a) == normalized(b)
  }

  /// Same URL apart from the fragment, and the new one has a fragment: a same-document navigation.
  private static func isFragmentOnly(_ target: URL?, from current: URL?) -> Bool {
    guard let target, let current, target.fragment != nil else { return false }
    var a = URLComponents(url: target, resolvingAgainstBaseURL: false)
    var b = URLComponents(url: current, resolvingAgainstBaseURL: false)
    a?.fragment = nil
    b?.fragment = nil
    return a == b
  }
}

private let askTimeout: TimeInterval = 1
