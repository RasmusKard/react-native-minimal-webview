import WebKit

var (total, failed) = (0, 0)
func check(_ name: String, _ ok: Bool) {
  total += 1
  if !ok {
    failed += 1
    print("FAIL \(name)")
  }
}

var teardown: [String] = []
func released(_ options: String) -> [String] {
  teardown = []
  MainActor.assumeIsolated {
    autoreleasepool {
      let view = MinimalWebView()
      view.hookOptions = ["teardown": options]
      view.applyProps()
    }
  }
  return teardown
}
MainActor.assumeIsolated {
  MinimalWebViewHooks.register("teardown") { _, context in
    if context.options as? String == "ask" { context.ask("question", [:]) { teardown.append("answered \($0 as Any)") } }
    context.onDocumentEnd { teardown.append("documentEnd \($0)") }
    context.onDestroyed { teardown.append("destroyed \($0)") }
  }
}
let quiet = released("quiet")
check("a view released without invalidate ends its Document and tears down: \(quiet)", quiet == ["documentEnd closing", "destroyed closing"])
let asked = released("ask")
check(
  "a view whose hook asked, released without invalidate, answers the ask and tears down: \(asked)",
  asked == ["answered nil", "documentEnd closing", "destroyed closing"])

final class ReadRoots: WKWebView {
  static var granted: [URL] = []

  override func loadFileURL(_ url: URL, allowingReadAccessTo readAccessURL: URL) -> WKNavigation? {
    Self.granted.append(readAccessURL)
    return super.loadFileURL(url, allowingReadAccessTo: readAccessURL)
  }
}

func spin(within seconds: TimeInterval = 10, until done: () -> Bool) -> Bool {
  let end = Date().addingTimeInterval(seconds)
  while !done(), Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
  return done()
}

let site = FileManager.default.temporaryDirectory.appendingPathComponent("mrw-view-\(getpid())/site/", isDirectory: true)
try FileManager.default.createDirectory(at: site.appendingPathComponent("sub"), withIntermediateDirectories: true)
try "<p>index</p>".write(to: site.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
let missing = site.appendingPathComponent("sub/missing.html")
MainActor.assumeIsolated {
  MinimalWebViewHooks.register("readRoots", webViewClass: ReadRoots.self) { _, _ in }
  var errors = 0
  var loading = true
  let view = MinimalWebView()
  view.onError.onEventSent = { _ in errors += 1 }
  view.onNavigationState.onEventSent = { loading = $0["loading"] as? Bool ?? true }
  view.hookOptions = ["readRoots": true]
  view.navigationRules = [["action": "allow"]]
  var source = WebViewSource()
  (source.uri, source.readAccessRoot) = (site.appendingPathComponent("index.html").absoluteString, site.absoluteString)
  view.source = source
  view.applyProps()
  func failure(_ start: () -> Void) -> Bool {
    let before = errors
    start()
    return spin { errors > before && !loading }
  }
  func retryRoot() -> URL? {
    ReadRoots.granted = []
    let ended = failure { view.retry() }
    return ended ? ReadRoots.granted.last : nil
  }
  check("read root: the source loads", spin { !loading && view.url.hasSuffix("index.html") })
  check("read root: load() of a missing file fails", failure { view.load(url: missing.absoluteString) })
  let ownRoot = retryRoot()
  check("read root: a retry of a failed load() reads within its directory: \(ownRoot as Any)", ownRoot == missing.deletingLastPathComponent())
  check("read root: the page's own load of that URL fails", failure { view.webView?.evaluateJavaScript("location.href = 'sub/missing.html'") })
  let pageRoot = retryRoot()
  check("read root: a retry of the page's failed load reads within the source's root: \(pageRoot as Any)", pageRoot == site)
  check("read root: load() of the missing file fails again", failure { view.load(url: missing.absoluteString) })
  let againRoot = retryRoot()
  check("read root: a retry of the second failed load() reads within its directory: \(againRoot as Any)", againRoot == missing.deletingLastPathComponent())
  let retriedRoot = retryRoot()
  check("read root: a retry of that retry reads within the same directory: \(retriedRoot as Any)", retriedRoot == missing.deletingLastPathComponent())
  view.invalidate()
}
try FileManager.default.removeItem(at: site.deletingLastPathComponent())

final class FailingScheme: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    if task.request.url?.host == "committed" {
      task.didReceive(URLResponse(url: task.request.url!, mimeType: "text/html", expectedContentLength: -1, textEncodingName: "utf-8"))
      task.didReceive(Data("<p>partial</p>".utf8))
    }
    task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost))
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class FailureCallbacks: NSObject, WKNavigationDelegate {
  var called: [String] = []

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    called.append("didFail")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    called.append("didFailProvisionalNavigation")
  }
}

MainActor.assumeIsolated {
  let callbacks = FailureCallbacks()
  MinimalWebViewHooks.register(
    "failures", configure: { configuration, _ in configuration.setURLSchemeHandler(FailingScheme(), forURLScheme: "mrw-fail") }
  ) { _, context in context.navigationDelegates = [callbacks] }
  let view = MinimalWebView()
  view.hookOptions = ["failures": true]
  view.navigationRules = [["action": "allow"]]
  view.applyProps()
  func failed(_ url: String) -> [String] {
    callbacks.called = []
    view.load(url: url)
    _ = spin { !callbacks.called.isEmpty }
    return callbacks.called
  }
  let provisional = failed("mrw-fail://provisional")
  check("failure callbacks: a load that fails before it commits reaches a hook's didFailProvisionalNavigation: \(provisional)", provisional == ["didFailProvisionalNavigation"])
  let committed = failed("mrw-fail://committed")
  check("failure callbacks: a load that fails after it commits reaches a hook's didFail: \(committed)", committed == ["didFail"])
  view.invalidate()
}

MainActor.assumeIsolated {
  var decided: [String] = []
  var loading = true
  let view = MinimalWebView()
  view.onNavigation.onEventSent = { decided.append("\($0["action"] ?? "") \($0["url"] ?? "")") }
  view.onNavigationState.onEventSent = { loading = $0["loading"] as? Bool ?? true }
  view.navigationRules = [["host": ["blocked.test"], "action": "block"], ["action": "allow"]]
  view.requestHandlers = ["onNavigation"]
  var source = WebViewSource()
  source.html = "<p>rules</p>"
  view.source = source
  view.applyProps()
  _ = spin { !loading }
  view.webView?.evaluateJavaScript("location.href = 'https://blocked.test/'")
  _ = spin(within: 5) { !decided.isEmpty }
  check("navigation rules: a page's navigation that a rule blocks is reported as blocked: \(decided)", decided == ["block https://blocked.test/"])
  view.invalidate()
}

let cookieName = "mrw-view-\(getpid())"
func copiedToNative(_ webView: WKWebView, within seconds: TimeInterval = 10) -> Bool {
  let cookie = HTTPCookie(properties: [.name: cookieName, .value: "1", .domain: "example.com", .path: "/"])
  webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie!)
  defer { HTTPCookieStorage.shared.cookies?.filter { $0.name == cookieName }.forEach(HTTPCookieStorage.shared.deleteCookie) }
  return spin(within: seconds) { HTTPCookieStorage.shared.cookies?.contains { $0.name == cookieName } == true }
}
MainActor.assumeIsolated {
  func webView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    return WKWebView(frame: .zero, configuration: configuration)
  }
  let cookies = SharedCookies()
  let first = webView()
  cookies.set(true, for: first.configuration.websiteDataStore.httpCookieStore)
  check("shared cookies: a cookie the WebView sets reaches the native store", copiedToNative(first))
  cookies.set(false, for: first.configuration.websiteDataStore.httpCookieStore)
  check("shared cookies: turned off, a cookie the WebView sets stays in it", !copiedToNative(first, within: 1))
  let second = webView()
  cookies.set(true, for: second.configuration.websiteDataStore.httpCookieStore)
  check("shared cookies: turned on again for another WebView, its cookies reach the native store", copiedToNative(second))
  let third = webView()
  let store = third.configuration.websiteDataStore.httpCookieStore
  let native = HTTPCookie(properties: [.name: "\(cookieName)-native", .value: "1", .domain: "example.com", .path: "/"])!
  HTTPCookieStorage.shared.setCookie(native)
  cookies.set(true, for: store)
  var inWebView = false
  cookies.prepare { store.getAllCookies { inWebView = $0.contains { $0.name == native.name } } }
  check("shared cookies: prepare puts the native store's cookies into the WebView", spin { inWebView })
  cookies.set(false, for: store)
  HTTPCookieStorage.shared.deleteCookie(native)
}

print("\(total - failed)/\(total) view cases pass")
exit(failed == 0 ? 0 : 1)
