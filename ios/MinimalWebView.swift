import ExpoModulesCore
import WebKit

class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()

  // Props, applied together in applyProps()
  var source: [String: Any]?
  var bridgeScript: String?
  var bridgeOrigins: [String] = []
  private var loadedSource: NSDictionary?

  // Created after the first prop batch: some WKWebViewConfiguration settings are fixed at creation.
  private(set) var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String?
  private var provisional = false
  // Bridge: page calls wait for RN's answer here, by message id. WebKit requires each reply handler be called once.
  private var pendingReplies: [String: (Any?, String?) -> Void] = [:]
  private var lastEmitted: NSDictionary?
  private var emitScheduled = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  /// Called once per prop batch. `source` loads last so everything else is ready first.
  func applyProps() {
    let webView = self.webView ?? createWebView()
    guard let next = source, loadedSource != next as NSDictionary else { return }
    loadedSource = next as NSDictionary
    if let uri = next["uri"] as? String, let target = URL(string: uri) {
      webView.load(URLRequest(url: target))
    } else {
      webView.loadHTMLString(next["html"] as? String ?? "", baseURL: (next["baseUrl"] as? String).flatMap(URL.init))
    }
  }

  private func createWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    // ponytail: the bridge is set up at creation; changing it needs a new WebView
    if let bridgeScript {
      let controller = configuration.userContentController
      controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
      controller.addScriptMessageHandler(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    addSubview(webView)
    let changed = { [weak self] in self?.stateChanged() }
    observations = [
      webView.observe(\.url) { [weak self] webView, _ in self?.urlChanged(webView.url?.absoluteString) },
      webView.observe(\.title) { _, _ in changed() },
      webView.observe(\.isLoading) { _, _ in changed() },
      webView.observe(\.estimatedProgress) { _, _ in changed() },
      webView.observe(\.canGoBack) { _, _ in changed() },
      webView.observe(\.canGoForward) { _, _ in changed() }
    ]
    self.webView = webView
    return webView
  }

  /// During a provisional navigation `url` shows the in-flight URL; otherwise a change is same-document (pushState, hash).
  /// WebKit changes `url` before calling didStartProvisionalNavigation, so classify one run loop turn later.
  private func urlChanged(_ value: String?) {
    DispatchQueue.main.async { [weak self] in
      guard let self, value == self.webView?.url?.absoluteString else { return }
      if self.provisional {
        self.pendingUrl = value
      } else if let value {
        self.url = value
      }
      self.stateChanged()
    }
  }

  private func stateChanged() {
    guard !emitScheduled else { return }
    emitScheduled = true
    // Changes within one run loop pass are combined into one event.
    DispatchQueue.main.async { [weak self] in
      guard let self, let webView = self.webView else { return }
      self.emitScheduled = false
      let state: NSDictionary = [
        "url": self.url,
        "pendingUrl": self.pendingUrl as Any? ?? NSNull(),
        "title": webView.title ?? "",
        "loading": webView.isLoading,
        "progress": webView.estimatedProgress,
        "canGoBack": webView.canGoBack,
        "canGoForward": webView.canGoForward
      ]
      guard state != self.lastEmitted else { return }
      self.lastEmitted = state
      self.onNavigationState(state as? [String: Any] ?? [:])
    }
  }

  // MARK: Bridge

  func bridgeReceive(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard message.frameInfo.isMainFrame, originAllowed(message.frameInfo.securityOrigin), let text = message.body as? String else {
      return replyHandler(nil, "origin not allowed")
    }
    if let header = Self.header(text), header.kind == "call" {
      pendingReplies[header.id] = replyHandler
    } else {
      replyHandler(nil, nil)
    }
    onBridge(["message": text])
  }

  /// Answers a pending page call through its reply handler, or delivers a call or event to the page.
  func bridgePost(_ text: String) {
    if let header = Self.header(text), header.kind == "result" || header.kind == "error",
      let reply = pendingReplies.removeValue(forKey: header.id) {
      return reply(text, nil)
    }
    // The origin check runs in the page at delivery time: the document may have changed since the post was queued.
    webView?.callAsyncJavaScript(Self.deliver, arguments: ["message": text, "origins": bridgeOrigins], in: nil, in: .page) { [weak self] result in
      if case .success(let reply) = result, let reply = reply as? String {
        self?.onBridge(["message": reply])
      }
    }
  }

  /// Same rule format as originAllowed and the page client.
  private static let deliver = """
    const o = location.origin;
    const ok = origins.some((r) => {
      const [scheme, host] = r.split('://*.');
      return host === undefined ? r === '*' || r === o : o.startsWith(scheme + '://') && o.endsWith('.' + host);
    });
    return ok ? await window.nativeBridge?.__receive(message) : null;
    """

  private static func header(_ text: String) -> (kind: String, id: String)? {
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let kind = object["kind"] as? String, let id = object["id"] as? String else { return nil }
    return (kind, id)
  }

  /// Origin rules in Android's format: `https://example.com`, `https://*.example.com`, `http://localhost:8090`.
  private func originAllowed(_ origin: WKSecurityOrigin) -> Bool {
    let value = "\(origin.protocol)://\(origin.host)" + (origin.port == 0 ? "" : ":\(origin.port)")
    return bridgeOrigins.contains { rule in
      guard let wildcard = rule.range(of: "://*.") else { return rule == "*" || rule == value }
      return value.hasPrefix(rule[..<wildcard.lowerBound] + "://") && value.hasSuffix("." + rule[wildcard.upperBound...])
    }
  }

  private func failPendingReplies() {
    pendingReplies.values.forEach { $0(nil, "navigated") }
    pendingReplies.removeAll()
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    provisional = true
    pendingUrl = webView.url?.absoluteString
    stateChanged()
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    pendingUrl = webView.url?.absoluteString
    stateChanged()
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    failPendingReplies()
    provisional = false
    pendingUrl = nil
    url = webView.url?.absoluteString ?? url
    stateChanged()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    provisional = false
    pendingUrl = nil
    stateChanged()
  }
}

/// Holds the view weakly: WKUserContentController retains its handlers.
private final class WeakBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
  weak var view: MinimalWebView?

  init(_ view: MinimalWebView) {
    self.view = view
  }

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor (Any?, String?) -> Void
  ) {
    guard let view else { return replyHandler(nil, "gone") }
    view.bridgeReceive(message, replyHandler: replyHandler)
  }
}
