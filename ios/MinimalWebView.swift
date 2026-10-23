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
  /// The user scripts installScripts added: the others in the content controller are a hook's.
  private var ownScripts: [WKUserScript] = []
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
  let document = DocumentScope()
  /// The enabled hooks' contexts, for the life of the WKWebView: a hook may keep its own.
  var hookContexts: [String: HookContext] = [:]
  var nextAskId = 0
  /// URLs an `ask` allowed in this Document, keyed by mainFrame: a subframe's answer doesn't decide the main frame's.
  var askedAndAllowed: [Bool: Set<String>] = [:]
  /// A `source` load is being prepared (shared cookies): loads wait until it is done.
  private var preparing = false
  /// After a failed main-frame load `url` is the failed URL (as on Android, which commits an error page);
  /// WKWebView itself keeps the previous page, so `url` and reload() use this.
  private(set) var failedUrl: String?
  private var lastEmitted: NSDictionary?
  private var emitScheduled = false
  private var crashTimes: [Date] = []
  /// `evaluate` calls waiting for their result, by id, until a new document or a dead web process rejects them.
  private var evaluations: [Int: (Result<String, EvaluateError>) -> Void] = [:]
  private var nextEvaluation = 0

  // The origin of the document whose page client last posted, as `location.origin` writes it (`*` when every origin is
  // allowed). RN's messages are delivered only while the page still has it.
  var bridgeOrigin: String?
  // The JS dialog on screen, and how to complete it if it has to go away. WebKit requires exactly one completion.
  // While one is up the page is blocked, and an accessibility query into it (XCTest's) hangs for 60 s: hide it.
  var dialog: (controller: UIAlertController, cancel: () -> Void)? {
    didSet { webView?.accessibilityElementsHidden = dialog != nil }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    // What belongs to the Document (GLOSSARY.md, ADR 0001), reset in this order at every end. `closing` runs from deinit,
    // where a weak self is already nil and an unowned one traps; the scope dies with the view, so unsafe is safe.
    document.register { [unowned(unsafe) self] reason in self.failPendingAsks(reason) }
    document.register { [unowned(unsafe) self] _ in self.failEvaluations() }
    document.register { [unowned(unsafe) self] reason in
      self.bridgeOrigin = nil
      // JS queues bridge messages until the next page is ready; at unmount it rejects what is in flight itself.
      if reason != .closing, self.bridgeScript != nil { self.onBridge(["navigated": true]) }
    }
    document.register { [unowned(unsafe) self] _ in self.askedAndAllowed.removeAll() }
    document.register { [unowned(unsafe) self] _ in self.dismissDialog() }
    // The spinner belongs to a load, and a crash ends the load without a delegate callback.
    document.register { [unowned(unsafe) self] reason in if reason == .crashed { self.refresher.loadEnded() } }
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
    return URL(string: url).map { Self.sameURL($0, uri) } ?? false
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

  /// The `evaluate` ref method. The page encodes the value, as on Android: what JSON can't encode (a function, a
  /// cycle) gives "null". A new document rejects what is still waiting with `navigated`, as on Android: WebKit settles
  /// a call whose page went away seconds later or never.
  func evaluate(_ script: String, onResult: @escaping (Result<String, EvaluateError>) -> Void) {
    guard let webView else { return onResult(.failure(EvaluateError(code: "ERR_EVALUATE", message: "No WebView"))) }
    let id = nextEvaluation
    nextEvaluation += 1
    evaluations[id] = onResult
    let body = "return ((v) => { try { return JSON.stringify(v) ?? 'null' } catch { return 'null' } })(await (\n\(script)\n))"
    webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { [weak self] result in
      // Already rejected when its page went away.
      guard let onResult = self?.evaluations.removeValue(forKey: id) else { return }
      switch result {
      case .success(let value): onResult(.success(value as? String ?? "null"))
      case .failure(let error): onResult(.failure(EvaluateError(code: "ERR_EVALUATE", message: error.localizedDescription)))
      }
    }
  }

  /// The page the waiting `evaluate` calls run in is gone.
  private func failEvaluations() {
    let waiting = evaluations.values
    evaluations = [:]
    waiting.forEach { $0(.failure(EvaluateError(code: "navigated", message: "the page navigated before the script finished"))) }
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
    for (name, hook) in MinimalWebViewHooks.configure where options[name] != nil { hook(configuration, hookContext(name)) }
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
    // The live settings before the hooks, as on Android: what a hook sets wins over the package's defaults.
    report(platformSettings.apply(settings, webView: webView))
    detachers = MinimalWebViewHooks.attach.compactMap { name, hook in
      options[name] != nil ? hook(webView, hookContext(name)) : nil
    }
  }

  /// The bridge's page client first, then the app's scripts in order, then the hooks' own. Changes take effect from the
  /// next navigation.
  private func installScripts(_ controller: WKUserContentController) {
    // WebKit can only remove every script: take the hooks' out and add them back after the core's.
    let hooks = controller.userScripts.filter { script in !ownScripts.contains { $0 === script } }
    controller.removeAllUserScripts()
    ownScripts = []
    if let bridgeScript {
      ownScripts.append(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }
    for script in injectedScripts {
      guard let code = script.code else { continue }
      ownScripts.append(WKUserScript(source: code, injectionTime: .atDocumentStart, forMainFrameOnly: script.mainFrameOnly ?? true, in: .page))
    }
    (ownScripts + hooks).forEach { controller.addUserScript($0) }
    installedScripts = injectedScripts.map { $0.toDictionary() } as NSArray
  }

  private func tearDown() {
    document.end(.closing)
    cookies.detach()
    detachers.forEach { $0() }
    detachers = []
    hookContexts = [:]
    proxy.navigationDelegates = []
    proxy.uiDelegates = []
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
    refreshSoon()
    forward { $0.webView?(webView, didCommit: navigation) }
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
    refresher.loadEnded()
    refreshSoon()
    forward(callback)
  }

  /// The web content process died. The WKWebView survives it, so reload, unless it keeps crashing.
  /// WebKit does not say whether it crashed or was killed for memory, so `didCrash` is always true on iOS.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let now = Date()
    crashTimes = crashTimes.filter { now.timeIntervalSince($0) < crashWindow } + [now]
    // A POST source on screen isn't sent again unasked (a browser asks first): the app's reload() can.
    let recovered = crashTimes.count <= maxCrashesPerWindow && !onPostSource
    document.end(.crashed)
    if recovered {
      // The source again, with its headers (an html one isn't in the history), also when nothing has committed yet.
      // Any other page: reload() relaunches the process with the back-forward list's item, so history stays.
      if onSource || webView.backForwardList.currentItem == nil, let source { load(source) } else { reload() }
    }
    onProcessGone(["didCrash": true, "recovered": recovered])
    forward { $0.webViewWebContentProcessDidTerminate?(webView) }
  }
}

// ponytail: fixed crash-loop guard; make it a prop if an app needs a different policy
private let maxCrashesPerWindow = 3
private let crashWindow: TimeInterval = 60

/// What the hooks see of this view, through a HookContext per enabled hook. The delegate lists live on the proxy;
/// WebKit reads what a delegate responds to when it is assigned, so each change re-assigns it.
extension MinimalWebView: WebViewContext {
  func hookContext(_ name: String) -> HookContext {
    if let context = hookContexts[name] { return context }
    let context = HookContext(name, self)
    hookContexts[name] = context
    return context
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
