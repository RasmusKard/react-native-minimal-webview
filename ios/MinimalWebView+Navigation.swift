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
      return decide(.allow)
    }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: mainFrame, newWindow: false, userInitiated: action.navigationType == .linkActivated
    )
    let download = downloads.wantsDownload(action)
    // `<a download>` or blob: that no hook takes (no onDownload): .allow would show it as a page.
    let dropped = action.shouldPerformDownload && !download
    run(request) { [weak self] allowed in
      if allowed, dropped { self?.openDownload(target) }
      decide(allowed && !dropped ? (download ? .download : .allow) : .cancel)
    }
  }

  /// A download no hook takes (no onDownload): http(s) opens externally, reported like an `external` navigation; the
  /// browser fetches it without the page's session. A data: or blob: one only the page can read: dropped.
  func openDownload(_ url: URL) {
    guard ["http", "https"].contains(url.scheme?.lowercased()) else { return }
    let request = NavigationRules.Request(url: url.absoluteString, mainFrame: true, newWindow: false, userInitiated: false)
    finish(request, "external", nil) { _ in }
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
      self.loadProgrammatic(action.request)
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
    // Without an onNavigationRequest prop nobody could allow it.
    guard requestHandlers.contains("navigationRequest") else {
      finish(request, "block", decision.rule, completion)
      return
    }
    let id = register { [weak self] answer in
      // The view can be gone (teardown flushes pending asks from deinit): the decision handler must still be called.
      guard let self else { return completion(false) }
      let action = answer as? String ?? "block"
      if action == "allow" { self.askedAndAllowed.insert(request.url) }
      self.finish(request, ["allow", "block", "external"].contains(action) ? action : "block", decision.rule, completion)
    }
    onNativeEvent(["name": "core.navigationRequest", "payload": request.payload, "askId": id])
    // Unanswered after the timeout: block.
    DispatchQueue.main.asyncAfter(deadline: .now() + askTimeout) { [weak self] in
      self?.pendingAsks.removeValue(forKey: id)?(nil)
    }
  }

  private func finish(_ request: NavigationRules.Request, _ action: String, _ rule: Int?, _ completion: (Bool) -> Void) {
    completion(action == "allow")
    guard action == "external", !requestHandlers.contains("openExternal") else { return report(request, action, rule) }
    // As on Android: an external URL that nothing opens is reported as blocked.
    guard let url = URL(string: request.url) else { return report(request, "block", rule) }
    UIApplication.shared.open(url) { [weak self] opened in self?.report(request, opened ? "external" : "block", rule) }
  }

  private func report(_ request: NavigationRules.Request, _ action: String, _ rule: Int?) {
    onNavigation(request.payload.merging(["action": action, "rule": rule as Any? ?? NSNull()]) { $1 })
  }

  func register(_ onAnswer: @escaping (Any?) -> Void) -> Int {
    nextAskId += 1
    pendingAsks[nextAskId] = onAnswer
    return nextAskId
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
}

private let askTimeout: TimeInterval = 1
