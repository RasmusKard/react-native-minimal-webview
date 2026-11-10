import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

/// Navigation rules, `ask`, new windows and external opening. The decision handler is held while JS answers an
/// `ask`, called exactly once, and blocked after 1 s or when the WebView goes away.
extension MinimalWebView {
  func decideNavigation(_ action: WKNavigationAction, decide: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    guard let target = action.request.url else { return decide(allowInPlace) }
    // New windows are decided in createWebViewWith; history steps, reloads, form POSTs and our own loads skip the
    // rules, as on Android (shouldOverrideUrlLoading is not called for them).
    guard let targetFrame = action.targetFrame else { return decide(allowInPlace) }
    let mainFrame = targetFrame.isMainFrame
    let own = mainFrame && programmaticUrl.map { Self.sameURL($0, target) } == true
    if own || action.navigationType == .backForward || action.navigationType == .reload
      || action.request.httpMethod == "POST" {
      if own { programmaticUrl = nil }
      return decide(allowInPlace)
    }
    let request = NavigationRules.Request(
      url: target.absoluteString, mainFrame: mainFrame, newWindow: false, userInitiated: userInitiated(action)
    )
    // A navigation WebKit marks as a download (`<a download>`, blob:). One no hook takes (no onDownload) is dropped:
    // .allow would show it as a page.
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

  /// Whether a user gesture started `action`: a link activation right after a tap on this view (`Taps`). WebKit reports
  /// every navigation with a triggering event as `.linkActivated` (NavigationAction.cpp's navigationType), a link a
  /// script clicks (`element.click()`) too, and no public WKNavigationAction property tells a real one apart. VoiceOver
  /// and Switch Control activate a link with no touch: while either runs, a link activation counts on its own. A
  /// hardware keyboard's doesn't count.
  private func userInitiated(_ action: WKNavigationAction) -> Bool {
    action.navigationType == .linkActivated
      && (taps.recent || UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning)
  }

  /// A download no `onDownload` takes.
  func openDownload(_ url: URL) {
    guard ["http", "https"].contains(url.scheme?.lowercased()) else { return }
    let request = NavigationRules.Request(url: url.absoluteString, mainFrame: true, newWindow: false, userInitiated: false)
    finish(request, "external", nil) { _ in }
  }

  /// window.open and target=_blank. Never a second WKWebView: a popup model (presenting and closing a child,
  /// `window.opener`, its own rules and bridge) is more than almost any app wants.
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
    // This load is the app's, past WebKit's limits on what a page may load, so only an http(s) POST skips the rules.
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
      canAsk: requestHandlers.contains("onNavigationRequest")
    )
    guard decision.action == "ask" else {
      finish(request, decision.action, decision.rule, completion)
      return
    }
    let id = asks.ask("core", "onNavigationRequest", request.payload) { [weak self] answer in
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
    guard action == "external" else { return report(request, action, rule) }
    guard requestHandlers.contains("onOpenExternal") else { return open(request, rule) }
    // A page that moved on first answers nil, which counts as opened. No timeout: nothing waits for the answer.
    asks.ask("core", "onOpenExternal", request.payload) { [weak self] answer in
      if answer as? Bool == false { self?.open(request, rule) } else { self?.report(request, "external", rule) }
    }
  }

  /// Opens an `external` URL outside the WebView. As on Android, one that nothing opens is reported as blocked.
  private func open(_ request: NavigationRules.Request, _ rule: Int?) {
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

/// When a tap on the WKWebView last ended, for `userInitiated`. It only watches the view's touches: it never
/// recognizes, so it cancels, delays and prevents nothing (scrolling, links, text selection and the pull-to-refresh
/// control work as without it), and it fails at each touch's end, or as soon as the touch scrolls.
final class Taps: UIGestureRecognizer, UIGestureRecognizerDelegate {
  /// In system uptime, a clock the device time doesn't move.
  private var lastTap: TimeInterval = -.infinity

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesEnded = false
    delegate = self
  }

  /// A tap ended within `tapWindow`.
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

  /// A touch that scrolls or zooms the page, or a scrollable box in it (WebKit gives each its own UIScrollView), is no
  /// tap, as in Chromium, where lifting a finger after a scroll gives the page no user activation
  /// (pointer_event_manager.cc).
  private func scrolls(_ touches: Set<UITouch>) -> Bool {
    touches.contains { touch in
      touch.gestureRecognizers?.contains { recognizer in
        guard let scrollView = recognizer.view as? UIScrollView else { return false }
        return scrollView.isDragging || scrollView.isZooming
      } == true
    }
  }

  /// Another recognizer that recognizes before the touch ends (WebKit's touch events one begins at touch down) leaves
  /// this one watching instead of failing it.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    true
  }
}

/// WebKit sends a tap's click once the finger lifts, at once on a page sized to the device (`width=device-width`) or
/// after its double-tap wait (about 350 ms) on one that can zoom, and the link's decision follows from the web content
/// process. A second covers that on a busy page, and a redirect of the tapped link that answers within it; it leaves a
/// script little time to ride on an unrelated tap, where Chromium's user activation lasts 5 s.
private let tapWindow: TimeInterval = 1
