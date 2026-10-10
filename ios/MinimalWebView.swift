import ExpoModulesCore
import WebKit

class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()
  let onExtension = EventDispatcher()
  let onError = EventDispatcher()
  let onProcessGone = EventDispatcher()
  let onNavigation = EventDispatcher()

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
  var javaScriptCanOpenWindowsAutomatically = false
  var webviewDebuggingEnabled = false
  var navigationRules: [[String: Any]]?
  var injectedScripts: [[String: Any]] = []
  private var installedScripts: NSArray?
  /// The page requests JS has a prop for (`download`, `navigationRequest`, ...), read when a request comes. `openExternal`
  /// is there when JS handles `external` navigations (onOpenExternal); native only reports them.
  var requestHandlers: Set<String> = []
  private var loadedSource: NSDictionary?

  // Some WKWebViewConfiguration settings are fixed at creation: changing one recreates the WebView. The bridge and the
  // extensions are set up with each WKWebView too; JS fixes them at mount, so they never change.
  private(set) var webView: WKWebView?
  private var creationSettings: NSDictionary?
  private var observations: [NSKeyValueObservation] = []
  // Created with each WKWebView (see recreate), detached in tearDown: the extensions, then the core's page requests, so
  // an extension that handles the same callback comes first.
  private(set) var activeExtensions: [WebViewExtension]?

  // Navigation state, derived from WebKit in refreshUrls(). Native owns the committed URL; JS is told.
  private(set) var url = ""
  private var pendingUrl: String?
  private var refreshScheduled = false
  /// An html source never reaches the back-forward list (WebKit hides substitute-data loads from session history):
  /// while the item that was current at its commit stays current, the html page is what is on screen.
  private var htmlNavigation: WKNavigation?
  private var htmlCommit: (url: String, item: WKBackForwardListItem?)?
  /// The URL this view loads itself (source, reload after an error, an allowed new window): it skips the rules.
  var programmaticUrl: URL?
  /// Every `ask` (navigation and extension) waits here for JS, by id, until answered through `answer`.
  var pendingAsks: [Int: (Any?) -> Void] = [:]
  var nextAskId = 0
  var askedAndAllowed: Set<String> = []
  /// Extensions are preparing a new WKWebView (shared cookies): loads wait until they are done.
  private var preparing = false
  /// After a failed main-frame load `url` is the failed URL (as on Android, which commits an error page);
  /// WKWebView itself keeps the previous page, so `url` and reload() use this.
  private(set) var failedUrl: String?
  private var lastEmitted: NSDictionary?
  private var emitScheduled = false
  private var crashTimes: [Date] = []

  // Bridge: page calls wait for RN's answer here, by message id. WebKit requires each reply handler be called once.
  var pendingReplies: [String: (Any?, String?) -> Void] = [:]
  // The origin of the document whose page client last posted, as `location.origin` writes it (`*` when every origin is
  // allowed). RN's messages are delivered only while the page still has it.
  var bridgeOrigin: String?
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
      "inline": allowsInlineMediaPlayback
    ]
    if settings != creationSettings {
      if webView != nil {
        log.warn("[react-native-minimal-webview] a setting fixed at creation changed; recreating the WebView")
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
    // Shared with the live WebView (the configuration getter copies, but keeps the same preferences object).
    webView.configuration.preferences.javaScriptCanOpenWindowsAutomatically = javaScriptCanOpenWindowsAutomatically
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
      var request = URLRequest(url: target)
      (source["headers"] as? [String: Any])?.forEach { request.setValue("\($0.value)", forHTTPHeaderField: $0.key) }
      loadProgrammatic(request)
    } else {
      htmlNavigation = webView?.loadHTMLString(source["html"] as? String ?? "", baseURL: (source["baseUrl"] as? String).flatMap(URL.init))
    }
  }

  /// Loads a request the app started, not the page: it skips the navigation rules.
  func loadProgrammatic(_ request: URLRequest) {
    programmaticUrl = request.url
    webView?.load(request)
  }

  /// Retries the failed URL after an error; otherwise a plain reload.
  func reload() {
    if let failedUrl, let target = URL(string: failedUrl) {
      loadProgrammatic(URLRequest(url: target))
    } else {
      webView?.reload()
    }
  }

  /// A new WKWebView with the current settings. It reloads the page that was showing, or the source when there was
  /// none or it was an html source (whose document cannot be refetched).
  private func recreate() {
    let previous = webView?.url.flatMap { $0.scheme == "http" || $0.scheme == "https" ? $0 : nil }
    let reloadSource = previous == nil || source?["html"] != nil
    tearDown()
    let configuration = WKWebViewConfiguration()
    configuration.applicationNameForUserAgent = applicationNameForUserAgent
    configuration.mediaTypesRequiringUserActionForPlayback = mediaPlaybackRequiresUserAction ? .all : []
    configuration.allowsInlineMediaPlayback = allowsInlineMediaPlayback
    // A tap's window.open and target=_blank reach createWebViewWith, as on Android; the navigation rules decide.
    // Without a gesture only when the app opts in (javaScriptCanOpenWindowsAutomatically).
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = javaScriptCanOpenWindowsAutomatically
    if bridgeScript != nil {
      configuration.userContentController.addScriptMessageHandler(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    installScripts(configuration.userContentController)
    activeExtensions = extensions.compactMap { spec in
      guard let name = spec["name"] as? String, let instance = WebViewExtensions.create(name) else { return nil }
      let handles = Set(spec["handles"] as? [String] ?? [])
      instance.attach(host: Host(view: self, name: name) { handles.contains($0) }, config: spec["config"] as? [String: Any] ?? [:])
      return instance
    }
    let core: [WebViewExtension] = [Permissions(), Downloads(), HttpAuth()]
    core.forEach { $0.attach(host: Host(view: self, name: "core") { [weak self] in self?.requestHandlers.contains($0) == true }, config: [:]) }
    activeExtensions? += core
    activeExtensions?.forEach { $0.configure(configuration) }
    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    addSubview(webView)
    let changed = { [weak self] in self?.stateChanged() }
    observations = [
      webView.observe(\.url) { [weak self] _, _ in self?.refreshSoon() },
      // At once as well: a load that starts and fails within one pass must still reach JS as loading true -> false.
      webView.observe(\.isLoading) { [weak self] _, _ in
        self?.stateChanged()
        self?.refreshSoon()
      },
      webView.observe(\.title) { _, _ in changed() },
      webView.observe(\.estimatedProgress) { _, _ in changed() }
    ] + [\WKWebView.canGoBack, \.canGoForward].map { webView.observe($0) { _, _ in changed() } }
    self.webView = webView
    activeExtensions?.forEach { $0.didCreate(webView) }
    prepareExtensions(webView) { [weak self, weak webView] in
      guard let self, let webView else { return }
      if let previous, !reloadSource {
        self.loadProgrammatic(URLRequest(url: previous))
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
    activeExtensions?.forEach { $0.detach() }
    activeExtensions = nil
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
    htmlCommit = nil
  }

  deinit {
    // deinit is nonisolated; the view is released on the main thread, as UIKit views are.
    MainActor.assumeIsolated { tearDown() }
  }

  /// WebKit's `url` KVO fires before the delegate callbacks: read the state one main-queue turn later, once per turn.
  private func refreshSoon() {
    guard !refreshScheduled else { return }
    refreshScheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.refreshScheduled = false
      self?.refreshUrls()
    }
  }

  /// The page on screen: the back-forward list's current item is created on commit and updated by
  /// pushState/replaceState/hash; pending and provisional loads never touch it.
  private func refreshUrls() {
    guard let webView else { return }
    let item = webView.backForwardList.currentItem
    // Empty before the first commit: the URL being loaded is pendingUrl.
    let committed = htmlCommit.flatMap { $0.item === item ? $0.url : nil } ?? item?.url.absoluteString ?? ""
    // After a failed load WebKit keeps the previous page; `url` stays the failed URL until the next commit.
    url = failedUrl ?? committed
    // WebKit's `url` is the active URL: a pending or provisional load shows here first.
    let active = webView.url?.absoluteString
    pendingUrl = webView.isLoading && active != committed ? active : nil
    stateChanged()
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
    let failing = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString
      ?? nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? pendingUrl ?? url
    let ssl = nsError.domain == NSURLErrorDomain && (NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed).contains(nsError.code)
    failedUrl = failing
    onError(["kind": ssl ? "ssl" : "network", "url": failing, "code": nsError.code, "description": nsError.localizedDescription])
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decideNavigation(navigationAction, in: webView, decide: decisionHandler)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
  ) {
    if let policy = activeExtensions?.lazy.compactMap({ $0.decidePolicy(for: navigationResponse) }).first {
      return decisionHandler(policy)
    }
    // A file no hook takes (no onDownload).
    if Downloads.isDownload(navigationResponse), let url = navigationResponse.response.url {
      openDownload(url)
      return decisionHandler(.cancel)
    }
    if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
      let description = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
      onError(["kind": "http", "url": response.url?.absoluteString ?? "", "code": response.statusCode, "description": description])
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
    // A page request (permission, HTTP auth) or navigation `ask` belongs to the document that made it. An HTTP auth
    // challenge holds its own page's response, so that page can't commit while it waits.
    failPendingAsks()
    failPendingReplies()
    bridgeOrigin = nil
    // A new document: JS queues bridge messages until the page is ready again.
    if bridgeScript != nil { onBridge(["navigated": true]) }
    askedAndAllowed.removeAll()
    programmaticUrl = nil
    failedUrl = nil
    htmlCommit = navigation === htmlNavigation
      ? (webView.url?.absoluteString ?? "about:blank", webView.backForwardList.currentItem) : nil
    refreshSoon()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageFinished(webView)
    refreshSoon()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
    pageFinished(webView)
    refreshSoon()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
    pageFinished(webView)
    refreshSoon()
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
    // (or the failed or committed URL) rather than jumping back to the source. An html source loads again.
    if recovered {
      let page = htmlCommit != nil ? nil : failedUrl.flatMap(URL.init) ?? webView.backForwardList.currentItem?.url ?? URL(string: url)
      if let page, page.scheme == "http" || page.scheme == "https" {
        loadProgrammatic(URLRequest(url: page))
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
  private let handled: (String) -> Bool

  init(view: MinimalWebView, name: String, handles: @escaping (String) -> Bool) {
    self.view = view
    self.name = name
    handled = handles
  }

  var webView: WKWebView? { view?.webView }

  func handles(_ event: String) -> Bool {
    handled(event)
  }

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
