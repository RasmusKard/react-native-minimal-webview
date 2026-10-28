import ExpoModulesCore
import WebKit

// swiftlint:disable file_length - because the view is the aggregate root: it holds what has one owner (the Expo surface, the platform WebView's life, crash recovery, the Document scope, the navigation state, the hook plumbing), and a feature with state of its own gets its own class
// swiftlint:disable:next type_body_length - because the view is the aggregate root: it holds what has one owner (the Expo surface, the platform WebView's life, crash recovery, the Document scope, the navigation state, the hook plumbing), and a feature with state of its own gets its own class
class MinimalWebView: ExpoView, WKNavigationDelegate {
  let onNavigationState = EventDispatcher()
  let onBridge = EventDispatcher()
  let onHookEvent = EventDispatcher()
  let onError = EventDispatcher()
  let onProcessGone = EventDispatcher()
  let onNavigation = EventDispatcher()

  // Props, applied together in applyProps(). The bridge, the hooks that attach and the `configuration` settings are
  // fixed at mount: they are read once, when the WKWebView is created.
  var source: WebViewSource?
  var bridgeScript: String?
  var bridgeOrigins: [String] = []
  /// The `hookOptions` prop: each hook's value by key. A change reaches the attached hooks (onOptionsChange).
  var hookOptions: [String: Any] = [:] {
    didSet { if webView != nil { optionsChanged(from: oldValue) } }
  }
  /// The `ios` prop: WebKit properties by name, applied by PlatformSettings.
  var settings: [String: Any] = [:]
  let platformSettings = PlatformSettings()
  var pullToRefresh = false
  private lazy var refreshControl: UIRefreshControl = {
    let control = UIRefreshControl()
    control.addAction(UIAction { [weak self] _ in self?.reload() }, for: .valueChanged)
    return control
  }()
  var sharedCookies = false
  private let cookies = SharedCookies()
  var navigationRules: [[String: Any]]?
  var injectedScripts: [InjectedScript] = []
  var installedScripts: NSArray?
  /// The user scripts installScripts added: the others in the content controller are a hook's.
  var ownScripts: [WKUserScript] = []
  /// The page requests JS has a prop for (`download`, `navigationRequest`, ...), read when a request comes.
  var requestHandlers: Set<String> = []
  private var loadedSource: NSDictionary?

  // Created once, from the first props: WebKit reads some WKWebViewConfiguration settings only at creation.
  private(set) var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []
  private(set) lazy var downloads = Downloads(view: self)
  private lazy var proxy = DelegateProxy(core: self)
  private var detachers: [() -> Void] = []

  // Navigation state, derived from WebKit in refreshUrls(). Native owns the committed URL; JS is told.
  private(set) var url = ""
  /// `url` as the hooks see it (`WebViewContext.url`): it follows `url` while no load is in flight and WebKit's own URL
  /// agrees, and takes the new page at each commit, after `onDocumentEnd`. WebKit moves the back-forward list to the
  /// next page before didCommit, and `url` can follow it early.
  private(set) var hookUrl = ""
  private var pendingUrl: String?
  /// An html source never reaches the back-forward list (WebKit hides substitute-data loads from session history):
  /// while the item that was current at its commit stays current, the html page is what is on screen.
  private var htmlNavigation: WKNavigation?
  private var htmlCommit: (url: String, item: WKBackForwardListItem?)?
  /// The URL this view loads itself (source, reload after an error, an allowed new window): it skips the rules.
  var programmaticUrl: URL?
  private(set) lazy var asks = Asks { [weak self] in self?.onHookEvent($0) }
  let document = DocumentScope()
  /// The enabled hooks' contexts in registration order, for the life of the WKWebView: a hook may keep its own.
  var hookContexts: [HookContext] = []
  /// URLs an `ask` allowed in this Document, keyed by mainFrame: a subframe's answer doesn't decide the main frame's.
  var askedAndAllowed: [Bool: Set<String>] = [:]
  /// A `source` load is being prepared (shared cookies): loads wait until it is done.
  private var preparing = false
  /// After a failed main-frame load `url` is the failed URL (as on Android, which commits an error page);
  /// WKWebView itself keeps the previous page, so `url` and reload() use this.
  private(set) var failedUrl: String?
  /// How the last load ended, "finished", "failed" or "cancelled"; JS sees it only while nothing loads.
  private var outcome: String?
  private var lastEmitted: NSDictionary?
  private var updateScheduled = false
  private var crashTimes: [Date] = []
  /// `evaluate` calls waiting for their result, by id, until a new document or a dead web process rejects them.
  var evaluations: [Int: (Result<String, EvaluateError>) -> Void] = [:]
  var nextEvaluation = 0

  // The origin of the document whose page client last posted, as `location.origin` writes it (`*` when every origin is
  // allowed). RN's messages are delivered only while the page still has it.
  var bridgeOrigin: String?
  // The JS dialog on screen, and how to complete it if it has to go away. WebKit requires exactly one completion.
  // While one is up the page is blocked, and an accessibility query into it (XCTest's) hangs: hide it.
  var dialog: (controller: UIAlertController, cancel: () -> Void)? {
    didSet { webView?.accessibilityElementsHidden = dialog != nil }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    // What belongs to the Document (DocumentScope), reset in this order at every end. `closing` comes from invalidate,
    // at unmount. In the deinit fallback self is already nil, so only the asks end (captured without the view): WebKit
    // throws for a decision handler released uncalled.
    document.register { [asks] in asks.documentEnded($0) }
    document.register { [weak self] _ in self?.failEvaluations() }
    document.register { [weak self] reason in
      guard let self else { return }
      bridgeOrigin = nil
      // JS queues bridge messages until the next page is ready; at unmount it rejects what is in flight itself.
      if reason != .closing, bridgeScript != nil { onBridge(["navigated": true]) }
    }
    document.register { [weak self] _ in self?.askedAndAllowed.removeAll() }
    document.register { [weak self] _ in self?.dismissDialog() }
    // The spinner belongs to a load, and a crash ends the load without a delegate callback.
    document.register { [weak self] reason in if reason == .crashed { self?.refreshControl.endRefreshing() } }
    // The hooks' own handlers, on their contexts: the scope has no unregister.
    document.register { [weak self] reason in self?.hookContexts.forEach { $0.documentEnded(reason) } }
  }

  /// Called once per prop batch. `source` loads last so everything else is ready first.
  func applyProps() {
    if webView == nil { createWebView() }
    guard let webView, !preparing else { return }
    if installedScripts != injectedScripts.map({ $0.toDictionary() }) as NSArray {
      installScripts(webView.configuration.userContentController)
    }
    report(platformSettings.apply(settings, webView: webView))
    let refresh = pullToRefresh ? refreshControl : nil
    if webView.scrollView.refreshControl !== refresh { webView.scrollView.refreshControl = refresh }
    cookies.set(sharedCookies)
    // Records aren't Equatable: compare their dictionaries.
    guard let next = source, loadedSource != next.toDictionary() as NSDictionary else { return }
    loadedSource = next.toDictionary() as NSDictionary
    // New content from the app: the crash-loop guard starts over (recovery reloads don't come through here).
    crashTimes = []
    prepareLoad(webView) { [weak self] in self?.load(next) }
  }

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
      if let body = source.body {
        request.httpMethod = "POST"
        request.httpBody = Data(body.utf8)
        if request.value(forHTTPHeaderField: "Content-Type") == nil {
          request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
      }
      loadProgrammatic(request)
    } else {
      htmlNavigation = webView?.loadHTMLString(source.html ?? "", baseURL: source.baseUrl.flatMap(URL.init))
    }
  }

  /// The page on screen (`url`) is the `source`: its URL, or an html source whose commit no other commit or failed load
  /// has followed.
  private var onSource: Bool {
    guard let source else { return false }
    guard let uri = source.uri.flatMap(URL.init) else { return htmlCommit != nil && failedUrl == nil }
    return Recovery.showsSource(uri.absoluteString, url)
  }

  /// The page on screen is the POST `source`: it can't be fetched again by URL, so reload loads the source instead.
  private var onPostSource: Bool { source?.body != nil && onSource }

  /// Settings keys that could not be applied, as warnings: JS logs them with console.warn.
  private func report(_ rejected: [[String: String]]) {
    for entry in rejected {
      emit("core.warning", ["message": "ios.\(entry["key"] ?? ""): \(entry["reason"] ?? "")"])
    }
  }

  /// Loads a request the app started, not the page: it skips the navigation rules. A file URL goes through loadFileURL
  /// with its directory as the read root, so the page's own assets load (load(_:) can't read local files).
  // shortcut: the read root is the file's directory; add a source field if a site needs a wider one
  func loadProgrammatic(_ request: URLRequest) {
    programmaticUrl = request.url
    if let url = request.url, url.isFileURL {
      webView?.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    } else {
      webView?.load(request)
    }
  }

  /// The ref's reload: an explicit retry starts the crash-loop guard over, like a new source. Recovery uses reload().
  func retry() {
    crashTimes = []
    reload()
  }

  func reload() {
    if onPostSource, let source {
      load(source)
    } else if let failedUrl, let target = URL(string: failedUrl) {
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
    hookContexts = MinimalWebViewHooks.hooks.filter { enables(hookOptions[$0.key]) }.map { HookContext($0, self) }
    for context in hookContexts { context.hook.configure?(configuration, context) }
    // A typo, or a hook's module not linked or not rebuilt.
    for key in hookOptions.keys where enables(hookOptions[key]) && !hookContexts.contains(where: { $0.key == key }) {
      emit("core.warning", ["message": "hookOptions.\(key): no hook is registered under this key"])
    }
    if bridgeScript != nil {
      configuration.userContentController.add(WeakBridgeHandler(self), contentWorld: .page, name: "nativeBridge")
    }
    installScripts(configuration.userContentController)
    let webView = MinimalWebViewHooks.webViewClass.init(frame: bounds, configuration: configuration)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.navigationDelegate = proxy
    webView.uiDelegate = proxy
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
    // The live settings before the hooks, as on Android: what a hook sets wins over the package's defaults.
    report(platformSettings.apply(settings, webView: webView))
    detachers = hookContexts.compactMap { $0.hook.attach(webView, $0) }
  }

  /// React Native calls `invalidate` on this view (the Fabric component view; Expo's are never recycled) at every
  /// unmount. Expo's Swift-visible header doesn't declare it, so Swift can't `override` it: declared here, it wins at
  /// runtime, and it calls the inherited one as `super` would.
  @objc func invalidate() {
    tearDown()
    // Expo's (React Native 0.82+) resets its size-update guard; React Native's UIView default does nothing.
    let selector = #selector(invalidate)
    typealias Invalidate = @convention(c) (AnyObject, Selector) -> Void
    guard class_respondsToSelector(ExpoView.self, selector),
      let inherited = class_getMethodImplementation(ExpoView.self, selector) else { return }
    unsafeBitCast(inherited, to: Invalidate.self)(self, selector)
  }

  /// Once: from invalidate, or from deinit if that never ran.
  private func tearDown() {
    guard let webView else { return }
    document.end(.closing)
    cookies.detach()
    detachers.forEach { $0() }
    detachers = []
    hookContexts = []
    proxy.navigationDelegates = []
    proxy.uiDelegates = []
    observations.removeAll()
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.stopLoading()
    // Audio and video otherwise keep playing after unmount (react-native-webview #2449, PR #3234).
    webView.pauseAllMediaPlayback()
    webView.removeFromSuperview()
    self.webView = nil
    htmlCommit = nil
  }

  deinit {
    // deinit is nonisolated; the view is released on the main thread, as UIKit views are.
    MainActor.assumeIsolated { tearDown() }
  }

  /// The page on screen: the back-forward list's current item, which a commit creates or moves to a moment before
  /// didCommit (a history step may move it earlier), and pushState/replaceState/hash update.
  private func refreshUrls() {
    guard let webView else { return }
    let item = webView.backForwardList.currentItem
    // Empty before the first commit: the URL being loaded is pendingUrl.
    let committed = htmlCommit.flatMap { $0.item === item ? $0.url : nil } ?? item?.url.absoluteString ?? ""
    url = failedUrl ?? committed
    // WebKit's `url` is the active URL: a pending or provisional load shows here first.
    let active = webView.url?.absoluteString
    pendingUrl = webView.isLoading && active != committed ? active : nil
    if !webView.isLoading, failedUrl != nil || active == committed { hookUrl = url }
  }

  /// WebKit's KVO fires before the delegate callbacks: the state is read and emitted one main-queue turn later, once
  /// per turn, so changes within one pass are combined into one event. The start of a load goes out at once as well: a
  /// load that starts and fails within one pass must still reach JS as loading true -> false. The end of a load waits
  /// for the pass, because WebKit clears isLoading before it reports the failure (the error and outcome go first).
  private func scheduleUpdate() {
    if let webView, webView.isLoading, lastEmitted?["loading"] as? Bool != true { emitState() }
    guard !updateScheduled else { return }
    updateScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      updateScheduled = false
      refreshUrls()
      emitState()
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
      "canGoForward": webView.canGoForward,
      "outcome": webView.isLoading ? NSNull() : outcome as Any? ?? NSNull()
    ]
    guard state != lastEmitted else { return }
    lastEmitted = state
    onNavigationState(state as? [String: Any] ?? [:])
  }

  /// An observation callback the core implements: every hook delegate that implements it gets it after the core.
  private func forward(_ callback: (WKNavigationDelegate) -> Void) {
    proxy.navigationDelegates.forEach(callback)
  }

  /// Main-frame failures only. Superseded navigations (cancelled) and policy cancels (frame load interrupted: a
  /// download, a 204, a blocked redirect) are not errors. Returns whether it was one.
  private func failed(_ error: Error) -> Bool {
    let nsError = error as NSError
    let cancelled = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    let interrupted = nsError.domain == "WebKitErrorDomain" && nsError.code == 102
    guard !cancelled, !interrupted else { return false }
    let failing = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString
      ?? nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? pendingUrl ?? url
    let ssl = nsError.domain == NSURLErrorDomain && (NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed).contains(nsError.code)
    failedUrl = failing
    onError(["kind": ssl ? "ssl" : "network", "url": failing, "code": nsError.code, "description": nsError.localizedDescription])
    return true
  }

  // MARK: WKNavigationDelegate

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
    document.end(.committed)
    programmaticUrl = nil
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
    outcome = error.map { failed($0) ? "failed" : "cancelled" } ?? "finished"
    // The spinner stops, or it would ignore the next pull.
    refreshControl.endRefreshing()
    scheduleUpdate()
    forward(callback)
  }

  /// The web content process died. The WKWebView survives it, so reload, unless it keeps crashing.
  /// WebKit does not say whether it crashed or was killed for memory, so `didCrash` is always true on iOS.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let recovered = Recovery.crashAllowsReload(&crashTimes, now: Date()) && !onPostSource
    document.end(.crashed)
    if lastEmitted?["loading"] as? Bool == true { outcome = "failed" } // the load the crash cut off
    if recovered {
      // The source again, with its headers (an html one isn't in the history), also when nothing has committed yet.
      // Any other page: reload() relaunches the process with the back-forward list's item, so history stays.
      if onSource || webView.backForwardList.currentItem == nil, let source { load(source) } else { reload() }
    }
    onProcessGone(["didCrash": true, "recovered": recovered])
    forward { $0.webViewWebContentProcessDidTerminate?(webView) }
  }
}

/// What the hooks see of this view, through a HookContext per enabled hook. The delegate lists live on the proxy;
/// WebKit reads what a delegate responds to when it is assigned, so each change re-assigns it.
extension MinimalWebView {
  /// Tells each attached hook whose value changed. A key that was not there when the WKWebView was made attaches nothing.
  private func optionsChanged(from old: [String: Any]) {
    for key in Set(old.keys).union(hookOptions.keys) {
      let value = hookOptions[key]
      if let was = old[key], let value, (was as AnyObject as? NSObject)?.isEqual(value) == true { continue }
      if let context = hookContexts.first(where: { $0.key == key }) {
        context.optionsChanged(value)
      } else if !enables(old[key]), enables(value) {
        emit("core.warning", ["message": "hookOptions.\(key): added after the WebView was created, so no hook attaches for it"])
      }
    }
  }

  func hookHandler(_ key: String, _ method: String) -> (([Any], @escaping (Any?) -> Void) -> Void)? {
    hookContexts.first { $0.key == key }?.handlers[method]
  }

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
    onHookEvent(["name": name, "payload": payload])
  }
}
