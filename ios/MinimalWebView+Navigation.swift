import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

extension MinimalWebView {
  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler decide: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    // A new window's navigation action has no target frame.
    guard let target = action.request.url, let targetFrame = action.targetFrame else { return decide(allowInPlace) }
    if takeOwnLoad(action) || action.navigationType == .backForward || action.navigationType == .reload
      || action.request.httpMethod == "POST" {
      return decide(allowInPlace)
    }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: targetFrame.isMainFrame, newWindow: false, userInitiated: userInitiated(action)
    )
    // `.allow` would show a navigation WebKit marks as a download (`<a download>`, blob:) as a page.
    let download = action.shouldPerformDownload && requestHandlers.contains("onDownload")
    let dropped = action.shouldPerformDownload && !download
    run(request) { [weak self] allowed in
      guard allowed else { return decide(.cancel) }
      if dropped {
        self?.openDownload(target)
        return decide(.cancel)
      }
      decide(download ? .download : allowInPlace)
    }
  }

  func takeOwnLoad(_ action: WKNavigationAction) -> Bool {
    guard action.targetFrame?.isMainFrame == true, let target = action.request.url else { return false }
    return ownLoads.check(target)
  }

  /// WebKit reports a link a script clicks (`element.click()`) as `.linkActivated` too, and no public
  /// WKNavigationAction property tells a real one apart.
  private func userInitiated(_ action: WKNavigationAction) -> Bool {
    action.navigationType == .linkActivated
      && (taps.recent || UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning)
  }

  func openDownload(_ url: URL) {
    guard ["http", "https"].contains(url.scheme?.lowercased()) else { return }
    let request = NavigationRules.Request(url: url.absoluteString, mainFrame: true, newWindow: false, userInitiated: false)
    finish(request, .external, nil) { _ in }
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    let tapped = userInitiated(action)
    guard let target = action.request.url?.absoluteString, !target.isEmpty, target != "about:blank" else {
      return WindowCatcher.window(configuration) { [weak self] request in self?.openWindow(request, tapped) }
    }
    openWindow(action.request, tapped)
    return nil
  }

  private func openWindow(_ request: URLRequest, _ userInitiated: Bool) {
    guard let target = request.url else { return }
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

  private func run(_ request: NavigationRules.Request, completion: @escaping (Bool) -> Void) {
    // WebKit's navigation action has no redirect flag.
    let decision = NavigationRules.decide(
      navigationRules, request, asked: askedAndAllowed[request.mainFrame] ?? [],
      canAsk: requestHandlers.contains("onNavigationRequest")
    )
    guard decision.action == .ask else {
      finish(request, decision.action, decision.rule, completion)
      return
    }
    let asked = asks.ask("core", "onNavigationRequest", request.payload) { [weak self] answer in
      guard let self else { return completion(false) }
      let action = NavigationRules.answer(answer)
      if action == .allow { self.askedAndAllowed[request.mainFrame, default: []].insert(request.url) }
      self.finish(request, action, decision.rule, completion)
    }
    guard let id = asked else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + askTimeout) { [weak self] in
      self?.asks.cancel(id)
    }
  }

  private func finish(
    _ request: NavigationRules.Request, _ action: NavigationRules.Action, _ rule: Int?, _ completion: (Bool) -> Void
  ) {
    completion(action == .allow)
    guard action == .external else { return report(request, action, rule) }
    guard requestHandlers.contains("onOpenExternal") else { return open(request, rule) }
    asks.ask("core", "onOpenExternal", request.payload) { [weak self] answer in
      if answer as? Bool == false { self?.open(request, rule) } else { self?.report(request, .external, rule) }
    }
  }

  private func open(_ request: NavigationRules.Request, _ rule: Int?) {
    guard let url = URL(string: request.url) else { return report(request, .block, rule) }
    UIApplication.shared.open(url) { [weak self] opened in self?.report(request, opened ? .external : .block, rule) }
  }

  private func report(_ request: NavigationRules.Request, _ action: NavigationRules.Action, _ rule: Int?) {
    guard requestHandlers.contains("onNavigation") else { return }
    emit("core", "onNavigation", request.payload.merging(["action": action.rawValue, "rule": rule as Any? ?? NSNull()]) { $1 })
  }
}

private let askTimeout: TimeInterval = 1

/// WebKit needs a WKWebView made from the configuration it passes for a `window.open('')` the page navigates later.
private final class WindowCatcher: NSObject, WKNavigationDelegate, WKUIDelegate {
  private var child: WKWebView?
  private var caught: ((URLRequest) -> Void)?

  static func window(_ configuration: WKWebViewConfiguration, caught: @escaping (URLRequest) -> Void) -> WKWebView {
    let catcher = WindowCatcher()
    let child = WKWebView(frame: .zero, configuration: configuration)
    child.navigationDelegate = catcher
    child.uiDelegate = catcher
    (catcher.child, catcher.caught) = (child, caught)
    // WKWebView's delegates are weak.
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

  private func drop() {
    caught = nil
    DispatchQueue.main.async { [child] in withExtendedLifetime(child) {} }
    child = nil
  }
}

private let newWindowTimeout: TimeInterval = 5

/// WebKit's private `_WKNavigationActionPolicyAllowWithoutTryingAppLink` (allow + 2): `.allow` would hand a tapped
/// link to an installed app that claims it as a universal link.
/// `init(rawValue:)` accepts any value, so the fallback never applies.
private let allowInPlace = WKNavigationActionPolicy(rawValue: WKNavigationActionPolicy.allow.rawValue + 2) ?? .allow

final class Taps: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private var lastTap: TimeInterval = -.infinity

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesEnded = false
    delegate = self
  }

  var recent: Bool { ProcessInfo.processInfo.systemUptime - lastTap <= tapWindow }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesMoved(touches, with: event)
    if scrolls(touches) { state = .failed }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesEnded(touches, with: event)
    if !scrolls(touches) { lastTap = ProcessInfo.processInfo.systemUptime }
    state = .failed
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesCancelled(touches, with: event)
    state = .failed
  }

  /// WebKit gives the page and each scrollable box in it its own UIScrollView.
  private func scrolls(_ touches: Set<UITouch>) -> Bool {
    touches.contains { touch in
      touch.gestureRecognizers?.contains { recognizer in
        guard let scrollView = recognizer.view as? UIScrollView else { return false }
        return scrollView.isDragging || scrollView.isZooming
      } == true
    }
  }

  /// WebKit's touch events recognizer begins at touch down, which would otherwise fail this one.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    true
  }
}

/// WebKit sends the click after its double-tap wait (about 350 ms) on a page that can zoom, and the link's decision
/// follows from the web content process.
private let tapWindow: TimeInterval = 1
