import ExpoModulesCore
import WebKit

class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()

  // Props, applied together in applyProps()
  var source: [String: Any]?
  private var loadedSource: NSDictionary?

  // Created after the first prop batch: some WKWebViewConfiguration settings are fixed at creation.
  private(set) var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String?
  private var provisional = false
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
