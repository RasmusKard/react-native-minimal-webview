import UIKit
import WebKit

/// Navigation rules, `ask`, new windows and external opening. The decision handler is held while JS answers an
/// `ask`, called exactly once, and blocked after 1 s or when the WebView goes away.
extension MinimalWebView {
  func decideNavigation(_ action: WKNavigationAction, decide: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    guard let target = action.request.url else { return decide(allowInPlace) }
    // New windows are decided in createWebViewWith; history steps, reloads, form POSTs and our own loads skip the
    // rules, as on Android (shouldOverrideUrlLoading is not called for them).
    if action.targetFrame == nil { return decide(allowInPlace) }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    let own = mainFrame && programmaticUrl.map { Self.sameURL($0, target) } == true
    if own || action.navigationType == .backForward || action.navigationType == .reload
      || action.request.httpMethod == "POST" {
      if own { programmaticUrl = nil }
      return decide(allowInPlace)
    }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: mainFrame, newWindow: false, userInitiated: action.navigationType == .linkActivated
    )
    let download = downloads.wantsDownload(action)
    // `<a download>` or blob: that no hook takes (no onDownload): .allow would show it as a page.
    let dropped = action.shouldPerformDownload && !download
    run(request) { [weak self] allowed in
      if allowed, dropped { self?.openDownload(target) }
      decide(allowed && !dropped ? (download ? .download : allowInPlace) : .cancel)
    }
  }

  /// A download no hook takes (no onDownload): http(s) opens externally, reported like an `external` navigation; the
  /// browser fetches it without the page's session. A data: or blob: one only the page can read: dropped.
  func openDownload(_ url: URL) {
    guard ["http", "https"].contains(url.scheme?.lowercased()) else { return }
    let request = NavigationRules.Request(url: url.absoluteString, mainFrame: true, newWindow: false, userInitiated: false)
    finish(request, "external", nil) { _ in }
  }

  /// window.open and target=_blank: never a second WKWebView for the page, since a popup model (presenting and closing a
  /// child, `window.opener`, its own rules and bridge) is more than almost any app wants. `allow` loads the URL in this
  /// one. A window opened with no URL yet (`window.open('')`) gets a throwaway view that catches the URL the page sends
  /// it to (`WindowCatcher`), as on Android. An app that needs real popups takes `createWebViewWith` in a hook's UI
  /// delegate and owns the second view.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    let userInitiated = action.navigationType == .linkActivated
    guard let target = action.request.url?.absoluteString, !target.isEmpty, target != "about:blank" else {
      return WindowCatcher.window(configuration) { [weak self] request in self?.openWindow(request, userInitiated) }
    }
    openWindow(action.request, userInitiated)
    return nil
  }

  private func openWindow(_ request: URLRequest, _ userInitiated: Bool) {
    guard let target = request.url else { return }
    // A form POST to a web page skips the rules here too, and loads in place. This load is the app's, past WebKit's
    // limits on what a page may load, so any other scheme still meets the rules, which block file: and internal ones.
    if request.httpMethod == "POST", ["http", "https"].contains(target.scheme?.lowercased()) {
      return loadProgrammatic(request)
    }
    let window = NavigationRules.Request(
      url: target.absoluteString, mainFrame: true, newWindow: true, userInitiated: userInitiated
    )
    run(window) { [weak self] allowed in
      if allowed { self?.loadProgrammatic(request) }
    }
  }

  /// Applies the rules (and `ask`) to a request and reports the outcome; `completion` gets whether to load it here.
  private func run(_ request: NavigationRules.Request, completion: @escaping (Bool) -> Void) {
    // A URL an `ask` allowed is not asked again until the next main-frame commit (redirect loops). Without an
    // onNavigationRequest prop nobody could allow it.
    // WebKit has no redirect flag, so a tap on that URL isn't asked again either; Android skips only redirects.
    let decision = NavigationRules.decide(
      navigationRules, request, asked: askedAndAllowed[request.mainFrame] ?? [],
      canAsk: requestHandlers.contains("navigationRequest")
    )
    guard decision.action == "ask" else {
      finish(request, decision.action, decision.rule, completion)
      return
    }
    let id = asks.ask("core.navigationRequest", request.payload) { [weak self] answer in
      // The view can be gone: the decision handler must still be called.
      guard let self else { return completion(false) }
      let action = NavigationRules.answer(answer)
      if action == "allow" { self.askedAndAllowed[request.mainFrame, default: []].insert(request.url) }
      self.finish(request, action, decision.rule, completion)
    }
    // Unanswered after the timeout: block.
    DispatchQueue.main.asyncAfter(deadline: .now() + askTimeout) { [weak self] in
      self?.asks.cancel(id)
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

  /// Equal URLs, treating an empty path as "/": WebKit turns `https://example.com` into `https://example.com/`.
  static func sameURL(_ a: URL, _ b: URL) -> Bool {
    func normalized(_ url: URL) -> String? {
      guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
      if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
      return components.string
    }
    return normalized(a) == normalized(b)
  }
}

private let askTimeout: TimeInterval = 1

/// The window `window.open('')` (or about:blank) opens, which a page navigates later (`w.location = url`), as async
/// popup payment buttons do. WebKit needs a WKWebView for it, made from the configuration it passes (it requires that
/// object). This one is never shown: it cancels its first navigation and hands the request on, then goes; one that
/// hasn't navigated within 5 s, or that the page closes, goes unused.
private final class WindowCatcher: NSObject, WKNavigationDelegate, WKUIDelegate {
  private var child: WKWebView?
  private var caught: ((URLRequest) -> Void)?

  static func window(_ configuration: WKWebViewConfiguration, caught: @escaping (URLRequest) -> Void) -> WKWebView {
    let catcher = WindowCatcher()
    let child = WKWebView(frame: .zero, configuration: configuration)
    child.navigationDelegate = catcher
    child.uiDelegate = catcher
    (catcher.child, catcher.caught) = (child, caught)
    // The view's delegates are weak: the timer holds the catcher, and the catcher the view until it lets it go.
    DispatchQueue.main.asyncAfter(deadline: .now() + newWindowTimeout) { catcher.drop() }
    return child
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    guard action.request.url?.absoluteString != "about:blank" else { return decisionHandler(.allow) }
    decisionHandler(.cancel)
    let caught = self.caught
    drop()
    caught?(action.request)
  }

  func webViewDidClose(_ webView: WKWebView) {
    drop()
  }

  /// The view goes a turn later: this can run inside its own callback.
  private func drop() {
    caught = nil
    DispatchQueue.main.async { [child] in withExtendedLifetime(child) {} }
    child = nil
  }
}

private let newWindowTimeout: TimeInterval = 5

/// WebKit's private `_WKNavigationActionPolicyAllowWithoutTryingAppLink` (iOS 9+), as Firefox for iOS uses it: `.allow`
/// would hand a tapped link to another host to an installed app that claims it as a universal link, which Android's
/// WebView never does, so the same rules would split the platforms. Hand-off is an explicit `external` rule. The value
/// goes to WebKit unchecked on every OS: an NS_ENUM's `init(rawValue:)` accepts any value, so `?? .allow` only
/// satisfies the type, and nothing falls back if WebKit drops the value; only an app that claims a domain could tell.
private let allowInPlace = WKNavigationActionPolicy(rawValue: WKNavigationActionPolicy.allow.rawValue + 2) ?? .allow
