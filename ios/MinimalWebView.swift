import ExpoModulesCore
import WebKit

class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()
  let onNativeEvent = EventDispatcher()
  let onError = EventDispatcher()
  let onProcessGone = EventDispatcher()
  let onNavigation = EventDispatcher()

  // Props, applied together in applyProps(). The bridge, the hook options and the `configuration` settings are fixed
  // at mount: they are read once, when the WKWebView is created.
  var source: WebViewSource?
  var bridgeScript: String?
  var bridgeOrigins: [String] = []
  /// The `nativeOptions` prop, for the hooks.
  var options: [String: Any] = [:]
  /// The `ios` prop: WebKit properties by name, applied by PlatformSettings.
  var settings: [String: Any] = [:]
  let platformSettings = PlatformSettings()
  var pullToRefresh = false
  private lazy var refresher = PullToRefresh { [weak self] in self?.reload() }
  var sharedCookies = false
  private let cookies = SharedCookies()
  var navigationRules: [[String: Any]]?
  var injectedScripts: [InjectedScript] = []
  private var installedScripts: NSArray?
  /// The page requests JS has a prop for (`download`, `navigationRequest`, ...), read when a request comes. `openExternal`
  /// is there when JS handles `external` navigations (onOpenExternal); native only reports them.
  var requestHandlers: Set<String> = []
  private var loadedSource: NSDictionary?

  // Created once, from the first props: WebKit reads some WKWebViewConfiguration settings only at creation.
  private(set) var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []
  // The page requests the core answers, and the WKWebView's delegate: it forwards each callback to this view or to
  // the hooks' delegates (DelegateProxy).
  private(set) lazy var permissions = Permissions(view: self)
  private(set) lazy var downloads = Downloads(view: self)
  private lazy var httpAuth = HttpAuth(view: self)
  private lazy var proxy = DelegateProxy(core: self)
  /// What the attach hooks returned, run in tearDown.
  private var detachers: [() -> Void] = []

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
  /// A `source` load is being prepared (shared cookies): loads wait until it is done.
  private var preparing = false
  /// After a failed main-frame load `url` is the failed URL (as on Android, which commits an error page);
  /// WKWebView itself keeps the previous page, so `url` and reload() use this.
  private(set) var failedUrl: String?
  private var lastEmitted: NSDictionary?
  private var emitScheduled = false
  private var crashTimes: [Date] = []

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
    if webView == nil { createWebView() }
    guard let webView, !preparing else { return }
    if installedScripts != injectedScripts.map({ $0.toDictionary() }) as NSArray {
      installScripts(webView.configuration.userContentController)
    }
    report(platformSettings.apply(settings, webView: webView))
    refresher.set(pullToRefresh, on: webView.scrollView)
    cookies.set(sharedCookies)
    // Records aren't Equatable: compare their dictionaries.
    guard let next = source, loadedSource != next.toDictionary() as NSDictionary else { return }
    loadedSource = next.toDictionary() as NSDictionary
    // New content from the app: the crash-loop guard starts over (recovery reloads don't come through here).
    crashTimes = []
    prepareLoad(webView) { [weak self] in self?.load(next) }
  }

  /// Runs the shared-cookie copy, holds loads until it is done, then loads.
  private func prepareLoad(_ webView: WKWebView, then load: @escaping () -> Void) {
    preparing = true
    cookies.prepare(webView) { [weak self, weak webView] in
      guard let self, let webView, webView === self.webView else { return }
      self.preparing = false
      load()
      // Props that changed while preparing (a newer source) apply now.
      self.applyProps()
    }
  }

  private func load(_ source: WebViewSource) {
    if let uri = source.uri, let target = URL(string: uri) {
      var request = URLRequest(url: target)
      source.headers?.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
      loadProgrammatic(request)
    } else {
      htmlNavigation = webView?.loadHTMLString(source.html ?? "", baseURL: source.baseUrl.flatMap(URL.init))
    }
  }

  /// Settings keys that could not be applied: JS warns.
  private func report(_ rejected: [[String: String]]) {
    if !rejected.isEmpty { emit("core.settingsRejected", ["rejected": rejected]) }
  }

  /// Loads a request the app started, not the page: it skips the navigation rules.
  func loadProgrammatic(_ request: URLRequest) {
    programmaticUrl = request.url
    webView?.load(request)
  }

  /// The `evaluate` ref method. The page encodes the value, as on Android: what JSON can't encode (a function, a
  /// cycle) gives "null".
  func evaluate(_ script: String, onResult: @escaping (Result<String, Error>) -> Void) {
    guard let webView else { return onResult(.failure(EvaluateError(code: "ERR_EVALUATE", message: "No WebView"))) }
    let body = "return ((v) => { try { return JSON.stringify(v) ?? 'null' } catch { return 'null' } })(await (\n\(script)\n))"
    webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value): onResult(.success(value as? String ?? "null"))
      case .failure(let error): onResult(.failure(EvaluateError(code: "ERR_EVALUATE", message: error.localizedDescription)))
      }
    }
  }

  func reload() {
    if let failedUrl, let target = URL(string: failedUrl) {
      loadProgrammatic(URLRequest(url: target))
    } else {
      webView?.reload()
    }
  }

  /// The WKWebView, from the first props. `source` loads from applyProps once the load is prepared.
  private func createWebView() {
    let configuration = WKWebViewConfiguration()
    // The creation-time settings (`ios.configuration`) and the configure hooks go first and the bridge after them,
    // so nothing they set displaces the content controller the bridge is installed in.
    report(platformSettings.apply(settings, webView: nil, configuration: configuration))
    MinimalWebViewHooks.configure.forEach { $0(configuration, self) }
    if bridgeScript != nil {
      configuration.userContentController.add(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    installScripts(configuration.userContentController)
    let webView = MinimalWebViewHooks.webViewClass.init(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = proxy
    webView.uiDelegate = proxy
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
    cookies.didCreate(webView)
    detachers = MinimalWebViewHooks.attach.compactMap { $0(webView, self) }
  }

  /// The bridge's page client first, then the app's scripts in order. Changes take effect from the next navigation.
  private func installScripts(_ controller: WKUserContentController) {
    controller.removeAllUserScripts()
    if let bridgeScript {
      controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }
    for script in injectedScripts {
      guard let code = script.code else { continue }
      let time: WKUserScriptInjectionTime = script.when == .end ? .atDocumentEnd : .atDocumentStart
      controller.addUserScript(WKUserScript(source: code, injectionTime: time, forMainFrameOnly: script.mainFrameOnly ?? false, in: .page))
    }
    installedScripts = injectedScripts.map { $0.toDictionary() } as NSArray
  }

  private func tearDown() {
    cookies.detach()
    detachers.forEach { $0() }
    detachers = []
    proxy.navigationDelegates = []
    proxy.uiDelegates = []
    failPendingAsks()
    dismissDialog()
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
    refresher.loadEnded()
    httpAuth.pageFinished()
  }

  /// An observation callback the core implements: every hook delegate that implements it gets it after the core.
  private func forward(_ callback: (WKNavigationDelegate) -> Void) {
    proxy.navigationDelegates.forEach(callback)
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
    if let policy = downloads.decidePolicy(for: navigationResponse) {
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
    let handled = isHTTPAuth && httpAuth.authenticate(challenge, completion: reply)
    // Server trust and everything else: WebKit's default (an invalid certificate fails, as on Android).
    if !handled { completionHandler(isHTTPAuth ? .rejectProtectionSpace : .performDefaultHandling, nil) }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    became(download) { $0.webView?(webView, navigationAction: navigationAction, didBecome: download) }
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    became(download) { $0.webView?(webView, navigationResponse: navigationResponse, didBecome: download) }
  }

  private func became(_ download: WKDownload, _ callback: (WKNavigationDelegate) -> Void) {
    downloads.didBecome(download)
    forward(callback)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    forward { $0.webView?(webView, didCommit: navigation) }
    // A page request (permission, HTTP auth) or navigation `ask` belongs to the document that made it. An HTTP auth
    // challenge holds its own page's response, so that page can't commit while it waits.
    failPendingAsks()
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
    loadEnded(webView) { $0.webView?(webView, didFinish: navigation) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadEnded(webView, error) { $0.webView?(webView, didFail: navigation, withError: error) }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadEnded(webView, error) { $0.webView?(webView, didFailProvisionalNavigation: navigation, withError: error) }
  }

  /// A load finished, or failed with `error`: the core's bookkeeping, then the hook delegates' callback.
  private func loadEnded(_ webView: WKWebView, _ error: Error? = nil, _ callback: (WKNavigationDelegate) -> Void) {
    if let error { failed(error) }
    pageFinished(webView)
    refreshSoon()
    forward(callback)
  }

  /// The web content process died. The WKWebView survives it, so reload, unless it keeps crashing.
  /// WebKit does not say whether it crashed or was killed for memory, so `didCrash` is always true on iOS.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    forward { $0.webViewWebContentProcessDidTerminate?(webView) }
    let now = Date()
    crashTimes = crashTimes.filter { now.timeIntervalSince($0) < crashWindow } + [now]
    let recovered = crashTimes.count <= maxCrashesPerWindow
    dismissDialog()
    // The page that asked is gone, as on Android (recover): fail its asks now rather than at the reload's commit, and
    // deliver nothing until the reloaded page posts.
    failPendingAsks()
    bridgeOrigin = nil
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

/// What the hooks see of this view. The delegate lists live on the proxy; WebKit reads what a delegate responds to
/// when it is assigned, so each change re-assigns it.
extension MinimalWebView: WebViewContext {
  var navigationDelegates: [WKNavigationDelegate] {
    get { proxy.navigationDelegates }
    set {
      proxy.navigationDelegates = newValue
      webView?.navigationDelegate = nil
      webView?.navigationDelegate = proxy
    }
  }

  var uiDelegates: [WKUIDelegate] {
    get { proxy.uiDelegates }
    set {
      proxy.uiDelegates = newValue
      webView?.uiDelegate = nil
      webView?.uiDelegate = proxy
    }
  }

  func emit(_ name: String, _ payload: [String: Any]) {
    onNativeEvent(["name": name, "payload": payload])
  }

  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) {
    onNativeEvent(["name": name, "payload": payload, "askId": register(onAnswer)])
  }
}

struct EvaluateError: Error {
  let code: String
  let message: String
}
