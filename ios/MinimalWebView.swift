import ExpoModulesCore
import WebKit

class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()
  let onExtension = EventDispatcher()
  let onError = EventDispatcher()
  let onProcessGone = EventDispatcher()
  let onNavigation = EventDispatcher()
  let onNavigationRequest = EventDispatcher()

  // Props, applied together in applyProps()
  var source: [String: Any]?
  var bridgeScript: String?
  var bridgeOrigins: [String] = []
  var extensions: [[String: Any]] = []
  var userAgent: String?
  var applicationNameForUserAgent: String?
  var mediaPlaybackRequiresUserAction = true
  var allowsInlineMediaPlayback = false
  var scrollEnabled = true
  var bounces = true
  var showsScrollIndicators = true
  var webviewDebuggingEnabled = false
  var navigationRules: [[String: Any]]?
  var injectedScripts: [[String: Any]] = []
  private var installedScripts: NSArray?
  /// JS handles `external` navigations (onOpenExternal); native only reports them.
  var openExternalInJS = false
  private var loadedSource: NSDictionary?

  // Some WKWebViewConfiguration settings are fixed at creation: changing one recreates the WebView.
  private(set) var webView: WKWebView?
  private var creationSettings: NSDictionary?
  private var observations: [NSKeyValueObservation] = []
  // Extensions live as long as this view; `didCreate` runs again for each new WebView.
  private(set) var activeExtensions: [WebViewExtension]?

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String?
  private var provisional = false
  /// Set when a main-frame navigation is allowed and cleared when it starts, fails or commits: WebKit changes `url`
  /// before didStartProvisionalNavigation, so this tells a new load from a same-document change (pushState, hash).
  var navigationExpected = false
  /// The URL this view loads itself (source, reload after an error, an allowed new window): it skips the rules.
  var programmaticUrl: URL?
  /// Every `ask` (navigation and extension) waits here for JS, by id, until answered through extensionCall.
  var pendingAsks: [Int: (Any?) -> Void] = [:]
  var nextAskId = 0
  var askedAndAllowed: Set<String> = []
  /// Extensions are preparing a new WKWebView (shared cookies): loads wait until they are done.
  private var preparing = false
  /// After a failed main-frame load `url` is the failed URL (as on Android, which commits an error page);
  /// WKWebView itself keeps the previous page, so getUrl() and reload() use this.
  private(set) var failedUrl: String?
  /// What the WKWebView actually shows (it keeps the old page after a failure).
  private var committedUrl: String?
  private var lastEmitted: NSDictionary?
  private var emitScheduled = false
  private var crashTimes: [Date] = []

  // Bridge: page calls wait for RN's answer here, by message id. WebKit requires each reply handler be called once.
  var pendingReplies: [String: (Any?, String?) -> Void] = [:]
  // The JS dialog on screen, and how to complete it if it has to go away. WebKit requires exactly one completion.
  var dialog: (controller: UIAlertController, cancel: () -> Void)?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  /// Called once per prop batch. `source` loads last so everything else is ready first.
  func applyProps() {
    let settings: NSDictionary = [
      "applicationName": applicationNameForUserAgent ?? NSNull(),
      "mediaRequiresAction": mediaPlaybackRequiresUserAction,
      "inline": allowsInlineMediaPlayback,
      "bridge": bridgeScript ?? NSNull(),
      "extensions": extensions
    ]
    if settings != creationSettings {
      if webView != nil {
        log.warn("[minimal-rn-webview] a setting fixed at creation changed; recreating the WebView")
      }
      creationSettings = settings
      recreate()
    }
    guard let webView, !preparing else { return }
    if installedScripts != injectedScripts as NSArray {
      installScripts(webView.configuration.userContentController)
    }
    webView.customUserAgent = userAgent
    webView.scrollView.isScrollEnabled = scrollEnabled
    webView.scrollView.bounces = bounces
    webView.scrollView.showsVerticalScrollIndicator = showsScrollIndicators
    webView.scrollView.showsHorizontalScrollIndicator = showsScrollIndicators
    webView.isInspectable = webviewDebuggingEnabled
    guard let next = source, loadedSource != next as NSDictionary else { return }
    loadedSource = next as NSDictionary
    // New content from the app: the crash-loop guard starts over (recovery reloads don't come through here).
    crashTimes = []
    prepareExtensions(webView) { [weak self] in self?.load(next) }
  }

  /// Runs every extension's `prepare` (shared cookies) and holds loads until all are done, then loads.
  private func prepareExtensions(_ webView: WKWebView, then load: @escaping () -> Void) {
    preparing = true
    let group = DispatchGroup()
    activeExtensions?.forEach { extensionInstance in
      group.enter()
      extensionInstance.prepare(webView) { group.leave() }
    }
    group.notify(queue: .main) { [weak self, weak webView] in
      guard let self, let webView, webView === self.webView else { return }
      self.preparing = false
      load()
      // Props that changed while preparing (a newer source) apply now.
      self.applyProps()
    }
  }

  private func load(_ source: [String: Any]) {
    if let uri = source["uri"] as? String, let target = URL(string: uri) {
      programmaticUrl = target
      var request = URLRequest(url: target)
      (source["headers"] as? [String: Any])?.forEach { request.setValue("\($0.value)", forHTTPHeaderField: $0.key) }
      webView?.load(request)
    } else {
      webView?.loadHTMLString(source["html"] as? String ?? "", baseURL: (source["baseUrl"] as? String).flatMap(URL.init))
    }
  }

  /// Retries the failed URL after an error; otherwise a plain reload.
  func reload() {
    if let failedUrl, let target = URL(string: failedUrl) {
      programmaticUrl = target
      webView?.load(URLRequest(url: target))
    } else {
      webView?.reload()
    }
  }

  /// A new WKWebView with the current settings. It reloads the page that was showing, or the source when there was
  /// none or it was an html source (whose document cannot be refetched).
  private func recreate() {
    let previous = webView?.url.flatMap { $0.scheme == "http" || $0.scheme == "https" ? $0 : nil }
    let reloadSource = previous == nil || source?["html"] != nil
    activeExtensions?.forEach { $0.detach() }
    activeExtensions = nil
    tearDown()
    let configuration = WKWebViewConfiguration()
    configuration.applicationNameForUserAgent = applicationNameForUserAgent
    configuration.mediaTypesRequiringUserActionForPlayback = mediaPlaybackRequiresUserAction ? .all : []
    configuration.allowsInlineMediaPlayback = allowsInlineMediaPlayback
    // window.open reaches createWebViewWith (gesture or not), as on Android; the navigation rules decide.
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
    if bridgeScript != nil {
      configuration.userContentController.addScriptMessageHandler(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    installScripts(configuration.userContentController)
    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    webView.uiDelegate = self
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
    if activeExtensions == nil {
      activeExtensions = extensions.compactMap { spec in
        guard let name = spec["name"] as? String, let instance = WebViewExtensions.create(name) else { return nil }
        instance.attach(host: Host(view: self, name: name), config: spec["config"] as? [String: Any] ?? [:])
        return instance
      }
    }
    activeExtensions?.forEach { $0.didCreate(webView) }
    prepareExtensions(webView) { [weak self, weak webView] in
      guard let self, let webView else { return }
      if let previous, !reloadSource {
        self.programmaticUrl = previous
        webView.load(URLRequest(url: previous))
      } else {
        self.loadedSource = self.source as NSDictionary?
        self.source.map(self.load)
      }
    }
  }

  /// The bridge's page client first, then the app's scripts in order. Changes take effect from the next navigation.
  private func installScripts(_ controller: WKUserContentController) {
    controller.removeAllUserScripts()
    if let bridgeScript {
      controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }
    for script in injectedScripts {
      guard let code = script["code"] as? String else { continue }
      let time: WKUserScriptInjectionTime = script["when"] as? String == "end" ? .atDocumentEnd : .atDocumentStart
      controller.addUserScript(WKUserScript(source: code, injectionTime: time, forMainFrameOnly: script["mainFrameOnly"] as? Bool ?? false, in: .page))
    }
    installedScripts = injectedScripts as NSArray
  }

  private func tearDown() {
    failPendingAsks()
    dismissDialog()
    failPendingReplies()
    observations.removeAll()
    webView?.configuration.userContentController.removeAllScriptMessageHandlers()
    webView?.stopLoading()
    // Audio and video otherwise keep playing after unmount (react-native-webview #2449, PR #3234).
    webView?.pauseAllMediaPlayback()
    webView?.removeFromSuperview()
    webView = nil
  }

  deinit {
    activeExtensions?.forEach { $0.detach() }
    // deinit is nonisolated; the view is released on the main thread, as UIKit views are.
    MainActor.assumeIsolated { tearDown() }
  }

  /// While a navigation is expected or provisional, `url` shows the in-flight URL; otherwise a change is same-document.
  private func urlChanged(_ value: String?) {
    guard let value else { return }
    if provisional || navigationExpected {
      pendingUrl = value
    } else if value != committedUrl || failedUrl == nil {
      // After a failed load WebKit reverts `url` to the page it kept; `url` stays the failed URL.
      url = value
      committedUrl = value
      failedUrl = nil
    }
    stateChanged()
  }

  /// A same-document history step (back across pushState entries) passes the policy check but never starts loading.
  func expireExpectedNavigation() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
      guard let self, self.navigationExpected, !self.provisional else { return }
      self.navigationExpected = false
      self.pendingUrl = nil
      self.urlChanged(self.webView?.url?.absoluteString)
    }
  }

  // Changes within one run loop pass are combined into one event, except the start of a load, which goes out at once:
  // a load that starts and fails within one pass must still reach JS as loading true -> false. The end of a load
  // waits for the pass, because WebKit clears isLoading before it reports the failure (onLoad must see the error).
  private func stateChanged() {
    if let webView, webView.isLoading, lastEmitted?["loading"] as? Bool != true { return emitState() }
    guard !emitScheduled else { return }
    emitScheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.emitScheduled = false
      self?.emitState()
    }
  }

  private func emitState() {
    guard let webView else { return }
    let state: NSDictionary = [
      "url": url,
      "pendingUrl": pendingUrl as Any? ?? NSNull(),
      "title": webView.title ?? "",
      "loading": webView.isLoading,
      "progress": webView.estimatedProgress,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward
    ]
    guard state != lastEmitted else { return }
    lastEmitted = state
    onNavigationState(state as? [String: Any] ?? [:])
  }

  private func pageFinished(_ webView: WKWebView) {
    activeExtensions?.forEach { $0.didFinish(url: webView.url) }
  }

  /// Main-frame failures only. Superseded navigations (cancelled) and policy cancels (frame load interrupted) are not errors.
  private func failed(_ error: Error) {
    let nsError = error as NSError
    let cancelled = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    let interrupted = nsError.domain == "WebKitErrorDomain" && nsError.code == 102
    guard !cancelled, !interrupted else { return }
    let failing = nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? pendingUrl ?? url
    let ssl = nsError.domain == NSURLErrorDomain && (NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed).contains(nsError.code)
    failedUrl = failing
    url = failing
    onError(["kind": ssl ? "ssl" : "network", "url": failing, "code": nsError.code, "description": nsError.localizedDescription, "isMainFrame": true])
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decideNavigation(navigationAction, in: webView, decide: decisionHandler)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    navigationExpected = false
    provisional = true
    pendingUrl = webView.url?.absoluteString
    stateChanged()
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    pendingUrl = webView.url?.absoluteString
    stateChanged()
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
  ) {
    if let policy = activeExtensions?.lazy.compactMap({ $0.decidePolicy(for: navigationResponse) }).first {
      return decisionHandler(policy)
    }
    if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
      let description = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
      onError(["kind": "http", "url": response.url?.absoluteString ?? "", "code": response.statusCode, "description": description, "isMainFrame": true])
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let method = challenge.protectionSpace.authenticationMethod
    let isHTTPAuth = method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodHTTPDigest
    // A declined login shows the site's 401 page. (.cancelAuthenticationChallenge would fail the navigation on iOS 17.)
    let reply = { (credential: URLCredential?) in completionHandler(credential == nil ? .rejectProtectionSpace : .useCredential, credential) }
    let handled = isHTTPAuth && activeExtensions?.contains { $0.authenticate(challenge, completion: reply) } == true
    // Server trust and everything else: WebKit's default (an invalid certificate fails, as on Android).
    if !handled { completionHandler(isHTTPAuth ? .rejectProtectionSpace : .performDefaultHandling, nil) }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    activeExtensions?.forEach { $0.didBecome(download) }
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    activeExtensions?.forEach { $0.didBecome(download) }
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    failPendingReplies()
    // A new document: JS queues bridge messages until the page is ready again.
    if bridgeScript != nil { onBridge(["navigated": true]) }
    askedAndAllowed.removeAll()
    programmaticUrl = nil
    navigationExpected = false
    provisional = false
    pendingUrl = nil
    failedUrl = nil
    url = webView.url?.absoluteString ?? url
    committedUrl = url
    stateChanged()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageFinished(webView)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
    pageFinished(webView)
    stateChanged()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    navigationExpected = false
    provisional = false
    pendingUrl = nil
    failed(error)
    pageFinished(webView)
    stateChanged()
  }

  /// The web content process died. The WKWebView survives it, so reload, unless it keeps crashing.
  /// WebKit does not say whether it crashed or was killed for memory, so `didCrash` is always true on iOS.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let now = Date()
    crashTimes = crashTimes.filter { now.timeIntervalSince($0) < crashWindow } + [now]
    let recovered = crashTimes.count <= maxCrashesPerWindow
    dismissDialog()
    failPendingReplies()
    // WebKit can clear `url` after the process dies while the back-forward list keeps the page: reload that page
    // (or the failed or committed URL) rather than jumping back to the source.
    if recovered {
      let page = failedUrl.flatMap(URL.init) ?? webView.backForwardList.currentItem?.url ?? URL(string: url)
      if let page, page.scheme == "http" || page.scheme == "https" {
        programmaticUrl = page
        webView.load(URLRequest(url: page))
      } else if let source {
        load(source)
      }
    }
    onProcessGone(["didCrash": true, "recovered": recovered])
  }
}

// ponytail: fixed crash-loop guard; make it a prop if an app needs a different policy
private let maxCrashesPerWindow = 3
private let crashWindow: TimeInterval = 60

/// One per extension, so its events carry its name.
private final class Host: ExtensionHost {
  private weak var view: MinimalWebView?
  private let name: String

  init(view: MinimalWebView, name: String) {
    self.view = view
    self.name = name
  }

  var webView: WKWebView? { view?.webView }

  func emit(_ event: String, _ payload: [String: Any]) {
    view?.onExtension(["name": name, "event": event, "payload": payload])
  }

  func reload() {
    view?.reload()
  }

  func ask(_ event: String, _ payload: [String: Any], onAnswer: @escaping (Any?) -> Void) {
    guard let view else { return onAnswer(nil) }
    view.onExtension(["name": name, "event": event, "payload": payload, "askId": view.register(onAnswer)])
  }
}
