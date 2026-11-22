import ExpoModulesCore
import WebKit

// swiftlint:disable file_length - because the view is the aggregate root
// swiftlint:disable:next type_body_length - because the view is the aggregate root
class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()
  let onHookEvent = EventDispatcher()
  let onError = EventDispatcher()
  let onProcessGone = EventDispatcher()
  let onNavigation = EventDispatcher()

  var source: WebViewSource?
  var bridgeScript: String?
  var bridgeOrigins: [String] = []
  var hookOptions: [String: Any] = [:] {
    didSet { if webView != nil { optionsChanged(from: oldValue) } }
  }
  var settings: [String: Any] = [:]
  let platformSettings = PlatformSettings()
  var pullToRefresh = false
  private(set) lazy var refreshControl: UIRefreshControl = {
    let control = UIRefreshControl()
    control.addAction(UIAction { [weak self] _ in self?.reload() }, for: .valueChanged)
    return control
  }()
  var sharedCookies = false
  private let cookies = SharedCookies()
  var navigationRules: [[String: Any]]?
  var injectedScripts: [InjectedScript] = [] {
    didSet { if let webView { installScripts(webView.configuration.userContentController) } }
  }
  var ownScripts: [WKUserScript] = []
  var requestHandlers: Set<String> = []
  private var loadedSource: NSDictionary?

  private(set) var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []
  private lazy var downloads = Downloads(view: self)
  private lazy var proxy = DelegateProxy(core: self)
  let taps = Taps(target: nil, action: nil)

  private(set) var url = ""
  /// `WebViewContext.url`: WebKit moves the back-forward list to the next page before didCommit, and `url` can follow it early.
  private(set) var hookUrl = ""
  private var pendingUrl: String?
  /// WebKit hides substitute-data loads (an html source) from the back-forward list.
  private var htmlNavigation: WKNavigation?
  private var htmlCommit: (url: String, item: WKBackForwardListItem?)?
  var ownLoads = OwnLoads()
  // No weak self: forming a weak reference to an object in deinit aborts, and deinit's tearDown can be the first use.
  private(set) lazy var asks = Asks { [onHookEvent] in onHookEvent($0) }
  var hookContexts: [HookContext] = []
  var askedAndAllowed: [Bool: Set<String>] = [:]
  private var preparing = false
  private var queuedUrl: URL?
  private var refLoad: URL?
  /// WKWebView keeps the previous page after a failed main-frame load.
  private(set) var failedUrl: String?
  private var outcome: Loads.Outcome?
  private var lastEmitted: NSDictionary?
  private var updateScheduled = false
  private var crashTimes: [TimeInterval] = []
  private var recoveryPending = false
  var evaluations: [Int: Promise] = [:]
  var nextEvaluation = 0

  var bridgeOrigin: String?
  // While a JS dialog is up the page is blocked, and an accessibility query into it (XCTest's) hangs.
  var dialog: (controller: UIAlertController, cancel: () -> Void)? {
    didSet { webView?.accessibilityElementsHidden = dialog != nil }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    NotificationCenter.default.addObserver(
      self, selector: #selector(recoverIfVisible), name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    recoverIfVisible()
  }

  @objc private func recoverIfVisible() {
    guard recoveryPending, window != nil, UIApplication.shared.applicationState != .background else { return }
    recoveryPending = false
    loadAgain()
  }

  private var documentOpen = false

  private func endDocument(_ reason: DocumentEnd) {
    let opening = reason == .committed && !documentOpen
    documentOpen = reason == .committed
    if !opening { asks.documentEnded(reason) }
    failEvaluations()
    bridgeOrigin = nil
    if reason == .committed, bridgeScript != nil { onBridge(["navigated": true]) }
    if reason == .crashed, bridgeScript != nil { onBridge(["crashed": true]) }
    askedAndAllowed.removeAll()
    dismissDialog()
    // A crash ends the load without a delegate callback.
    if reason == .crashed { refreshControl.endRefreshing() }
    if !opening { hookContexts.forEach { $0.documentEnded(reason) } }
  }

  func applyProps() {
    if webView == nil { createWebView() }
    guard let webView, !preparing else { return }
    report(platformSettings.apply(settings, webView: webView))
    let refresh = pullToRefresh ? refreshControl : nil
    if webView.scrollView.refreshControl !== refresh { webView.scrollView.refreshControl = refresh }
    cookies.set(sharedCookies)
    // Records aren't Equatable: compare their dictionaries.
    guard let next = source, loadedSource != next.toDictionary() as NSDictionary else { return }
    loadedSource = next.toDictionary() as NSDictionary
    crashTimes = []
    recoveryPending = false
    prepare(next)
  }

  func load(url: String) {
    guard let target = URL(string: url) else { return warn("load: \(url) is not a URL") }
    guard webView != nil else { return }
    crashTimes = []
    recoveryPending = false
    queuedUrl = target
    if !preparing { prepare(nil) }
  }

  private func prepare(_ source: WebViewSource?) {
    preparing = true
    cookies.prepare { [weak self, weak webView] in
      guard let self, let webView, webView === self.webView else { return }
      preparing = false
      if let queuedUrl {
        self.queuedUrl = nil
        refLoad = queuedUrl
        loadProgrammatic(URLRequest(url: queuedUrl), inSourceRoot: false)
      } else if let source {
        refLoad = nil
        load(source)
      }
      applyProps()
    }
  }

  private func load(_ source: WebViewSource) {
    if let uri = source.uri, let target = URL(string: uri) {
      var request = URLRequest(url: target)
      source.headers?.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
      if let body = source.body {
        request.httpMethod = "POST"
        request.httpBody = Data(body.utf8)
        if request.value(forHTTPHeaderField: "Content-Type") == nil {
          request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
      }
      loadProgrammatic(request)
    } else {
      let baseURL = source.baseUrl.flatMap(URL.init)
      // WebKit puts the html load through decidePolicyFor at its base URL, about:blank without one.
      if let own = baseURL ?? URL(string: "about:blank") { ownLoads.started(own) }
      htmlNavigation = webView?.loadHTMLString(source.html ?? "", baseURL: baseURL)
    }
  }

  private var onSource: Bool {
    guard let source else { return false }
    guard let uri = source.uri.flatMap(URL.init) else { return htmlCommit != nil && failedUrl == nil }
    return Recovery.showsSource(uri.absoluteString, url)
  }

  private var onPostSource: Bool { source?.body != nil && onSource }

  private func report(_ rejected: [[String: String]]) {
    for entry in rejected {
      warn("ios.\(entry["key"] ?? ""): \(entry["reason"] ?? "")")
    }
  }

  func loadProgrammatic(_ request: URLRequest, inSourceRoot: Bool = true) {
    if let url = request.url { ownLoads.started(url) }
    if let url = request.url, url.isFileURL {
      let access = ReadAccess.root(for: url, inSourceRoot ? source?.readAccessRoot : nil)
      if let warning = access.warning { warn(warning) }
      webView?.loadFileURL(url, allowingReadAccessTo: access.root)
    } else {
      webView?.load(request)
    }
  }

  func retry() {
    crashTimes = []
    reload()
  }

  func reload() {
    recoveryPending = false
    // WebKit's reload redoes no failed load, POST or html source, and loads nothing while `url` is nil.
    let onHtmlSource = onSource && source?.uri == nil
    if let webView, webView.url != nil, failedUrl == nil, !onPostSource, !onHtmlSource { webView.reload() } else { loadAgain() }
  }

  private func loadAgain() {
    guard let webView, !preparing else { return }
    if let source, onSource || failedUrl == nil && webView.backForwardList.currentItem == nil {
      load(source)
    } else if let failedUrl, let target = URL(string: failedUrl) {
      loadProgrammatic(URLRequest(url: target), inSourceRoot: !(refLoad.map { Loads.sameURL($0, target) } ?? false))
    } else {
      webView.reload()
    }
  }

  private func createWebView() {
    let configuration = WKWebViewConfiguration()
    report(platformSettings.apply(settings, webView: nil, configuration: configuration))
    hookContexts = MinimalWebViewHooks.hooks.filter { hookOptions[$0.key] != nil }.map { HookContext($0, self) }
    for context in hookContexts { context.hook.configure?(configuration, context) }
    for key in hookOptions.keys where !hookContexts.contains(where: { $0.key == key }) {
      warn("extension \(key): no hook is registered under this key")
    }
    if bridgeScript != nil {
      configuration.userContentController.add(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    installScripts(configuration.userContentController)
    let classes = hookContexts.compactMap { context in context.hook.webViewClass.map { (context.key, $0) } }
    let webViewClass = classes.first?.1 ?? WKWebView.self
    for (key, other) in classes where other != webViewClass {
      warn("extension \(key): its webViewClass is not used, \(classes[0].0)'s is")
    }
    let webView = webViewClass.init(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    proxy.hookDecides = { [weak self] in _ = self?.takeOwnLoad($0) }
    webView.navigationDelegate = proxy
    webView.uiDelegate = proxy
    webView.addGestureRecognizer(taps)
    addSubview(webView)
    let update = { [weak self] in self?.scheduleUpdate() }
    observations = [
      webView.observe(\.url) { _, _ in update() },
      webView.observe(\.isLoading) { _, _ in update() },
      webView.observe(\.title) { _, _ in update() },
      webView.observe(\.estimatedProgress) { _, _ in update() }
    ] + [\WKWebView.canGoBack, \.canGoForward].map { webView.observe($0) { _, _ in update() } }
    self.webView = webView
    cookies.didCreate(webView)
    report(platformSettings.apply(settings, webView: webView))
    hookContexts.forEach { $0.hook.attach(webView, $0) }
  }

  /// React Native calls `invalidate` at every unmount (Expo's views are never recycled), and Expo's (React Native 0.82+) resets its size-update guard.
  /// Expo's Swift-visible header doesn't declare it, so Swift can't `override` it: this one wins at runtime.
  @objc func invalidate() {
    tearDown()
    let selector = #selector(invalidate)
    typealias Invalidate = @convention(c) (AnyObject, Selector) -> Void
    guard class_respondsToSelector(ExpoView.self, selector),
      let inherited = class_getMethodImplementation(ExpoView.self, selector) else { return }
    unsafeBitCast(inherited, to: Invalidate.self)(self, selector)
  }

  private func tearDown() {
    guard let webView else { return }
    endDocument(.closing)
    cookies.detach()
    let closed = hookContexts
    closed.forEach { $0.detach() }
    hookContexts = []
    proxy.navigationDelegates = []
    proxy.uiDelegates = []
    observations.removeAll()
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.stopLoading()
    // Audio and video otherwise keep playing after unmount (react-native-webview #2449, PR #3234).
    webView.pauseAllMediaPlayback()
    webView.removeFromSuperview()
    closed.forEach { $0.destroyed() }
    self.webView = nil
    htmlCommit = nil
  }

  deinit {
    // deinit is nonisolated; the view is released on the main thread, as UIKit views are.
    MainActor.assumeIsolated { tearDown() }
  }

  private func refreshUrls() {
    guard let webView else { return }
    let item = webView.backForwardList.currentItem
    let committed = htmlCommit.flatMap { $0.item === item ? $0.url : nil } ?? item?.url.absoluteString ?? ""
    url = failedUrl ?? committed
    // WebKit's `url` is the active URL: a pending or provisional load shows here first.
    let active = webView.url?.absoluteString
    pendingUrl = webView.isLoading && active != committed ? active : nil
    if !webView.isLoading, failedUrl != nil || active == committed { hookUrl = url }
  }

  /// WebKit's KVO fires before the delegate callbacks, and clears isLoading before it reports a failure: the state is
  /// read a main-queue turn later.
  private func scheduleUpdate() {
    if loadStartUnsent { emitState() }
    guard !updateScheduled else { return }
    updateScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      updateScheduled = false
      refreshUrls()
      emitState()
    }
  }

  private var loadStartUnsent: Bool { webView?.isLoading == true && lastEmitted?["loading"] as? Bool != true }

  private func emitState() {
    guard let webView else { return }
    let state: NSDictionary = [
      "url": url,
      "pendingUrl": pendingUrl as Any? ?? NSNull(),
      "title": webView.title ?? "",
      "loading": webView.isLoading,
      "progress": webView.estimatedProgress,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward,
      "outcome": webView.isLoading ? NSNull() : outcome?.rawValue as Any? ?? NSNull()
    ]
    guard state != lastEmitted else { return }
    lastEmitted = state
    onNavigationState(state as? [String: Any] ?? [:])
  }

  private func forward(_ callback: (WKNavigationDelegate) -> Void) {
    proxy.navigationDelegates.forEach(callback)
  }

  /// Reports a failed main-frame load to onError and keeps its URL as `failedUrl`; returns the load's outcome.
  private func ended(with error: Error) -> Loads.Outcome {
    let nsError = error as NSError
    let end = Loads.ended(by: nsError)
    guard let kind = end.kind else { return end.outcome }
    let failing = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString
      ?? nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? pendingUrl ?? url
    failedUrl = failing
    onError(["kind": kind, "url": failing, "code": nsError.code, "description": nsError.localizedDescription])
    return end.outcome
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decideNavigation(navigationAction, decide: decisionHandler)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
  ) {
    if Downloads.isDownload(navigationResponse) {
      if requestHandlers.contains("onDownload") { return decisionHandler(.download) }
      if let url = navigationResponse.response.url {
        openDownload(url)
        return decisionHandler(.cancel)
      }
    }
    if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
      onError(["kind": "http", "url": response.url?.absoluteString ?? "", "statusCode": response.statusCode])
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    became(download) { $0.webView?(webView, navigationAction: navigationAction, didBecome: download) }
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    became(download) { $0.webView?(webView, navigationResponse: navigationResponse, didBecome: download) }
  }

  private func became(_ download: WKDownload, _ callback: (WKNavigationDelegate) -> Void) {
    if requestHandlers.contains("onDownload") { download.delegate = downloads }
    forward(callback)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    endDocument(.committed)
    ownLoads.committed()
    failedUrl = nil
    htmlCommit = navigation === htmlNavigation
      ? (webView.url?.absoluteString ?? "about:blank", webView.backForwardList.currentItem) : nil
    refreshUrls()
    hookUrl = url
    scheduleUpdate()
    forward { $0.webView?(webView, didCommit: navigation) }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loadEnded { $0.webView?(webView, didFinish: navigation) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadEnded(error) { $0.webView?(webView, didFail: navigation, withError: error) }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadEnded(error) { $0.webView?(webView, didFailProvisionalNavigation: navigation, withError: error) }
  }

  private func loadEnded(_ error: Error? = nil, _ callback: (WKNavigationDelegate) -> Void) {
    outcome = error.map { ended(with: $0) } ?? .finished
    // The spinner stops, or it would ignore the next pull.
    refreshControl.endRefreshing()
    scheduleUpdate()
    forward(callback)
  }

  /// The WKWebView survives its web content process's death.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let recovered = Recovery.crashAllowsReload(&crashTimes, now: ProcessInfo.processInfo.systemUptime) && !onPostSource
    endDocument(.crashed)
    if lastEmitted?["loading"] as? Bool == true { outcome = .failed }
    if recovered {
      recoveryPending = true
      recoverIfVisible()
    }
    onProcessGone(["cause": "unknown", "recovered": recovered])
    forward { $0.webViewWebContentProcessDidTerminate?(webView) }
  }
}

extension MinimalWebView {
  private func optionsChanged(from old: [String: Any]) {
    for key in inRegistrationOrder(Set(old.keys).union(hookOptions.keys), MinimalWebViewHooks.hooks.map(\.key)) {
      let (was, value) = (old[key], hookOptions[key])
      if staysOn(was, value) { continue }
      if let context = hookContexts.first(where: { $0.key == key }) {
        context.optionsChanged(value)
      } else if was == nil {
        attachLate(key)
      }
    }
  }

  private func attachLate(_ key: String) {
    guard let webView, let hook = MinimalWebViewHooks.hooks.first(where: { $0.key == key }) else {
      return warn("extension \(key): no hook is registered under this key")
    }
    guard hook.configure == nil, hook.webViewClass == nil else {
      let why = hook.configure != nil ? "configure" : "a webViewClass"
      return warn("extension \(key): its hook has \(why), so it attaches only when the WebView is created")
    }
    let context = HookContext(hook, self)
    hookContexts.append(context)
    hook.attach(webView, context)
  }

  func hookHandler(_ key: String, _ method: String) -> (([Any], HookReply) -> Void)? {
    hookContexts.first { $0.key == key && $0.isOn }?.handlers[method]
  }

  func routeDelegates() {
    let on = hookContexts.filter(\.isOn)
    proxy.navigationDelegates = on.flatMap(\.navigationDelegates)
    proxy.uiDelegates = on.flatMap(\.uiDelegates)
    // WebKit reads responds(to:) only when the delegate is set: unset first so it reads it again.
    webView?.navigationDelegate = nil
    webView?.navigationDelegate = proxy
    webView?.uiDelegate = nil
    webView?.uiDelegate = proxy
    proxy.newWarnings().forEach(warn)
  }

  func emit(_ key: String, _ name: String, _ payload: [String: Any]) {
    onHookEvent(["key": key, "name": name, "payload": payload])
  }

  func warn(_ message: String) {
    emit("core", "warning", ["message": message])
  }
}
