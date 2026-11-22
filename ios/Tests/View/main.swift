import WebKit

var (total, failed) = (0, 0)
func check(_ name: String, _ ok: Bool) {
  total += 1
  if !ok {
    failed += 1
    print("FAIL \(name)")
  }
}

var destroyed: [DocumentEnd] = []
MainActor.assumeIsolated {
  MinimalWebViewHooks.register("teardown") { _, context in context.onDestroyed { destroyed.append($0) } }
  autoreleasepool {
    let view = MinimalWebView()
    view.hookOptions = ["teardown": true]
    view.applyProps()
  }
}
check("a view released without invalidate tears down: \(destroyed)", destroyed == [.closing])

final class ReadRoots: WKWebView {
  nonisolated(unsafe) static var granted: [URL] = []

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
  view.invalidate()
}
try FileManager.default.removeItem(at: site.deletingLastPathComponent())

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
  let third = webView().configuration.websiteDataStore.httpCookieStore
  let native = HTTPCookie(properties: [.name: "\(cookieName)-native", .value: "1", .domain: "example.com", .path: "/"])!
  HTTPCookieStorage.shared.setCookie(native)
  cookies.set(true, for: third)
  var inWebView = false
  cookies.prepare { third.getAllCookies { inWebView = $0.contains { $0.name == native.name } } }
  check("shared cookies: prepare puts the native store's cookies into the WebView", spin { inWebView })
  cookies.set(false, for: third)
  HTTPCookieStorage.shared.deleteCookie(native)
}

print("\(total - failed)/\(total) view cases pass")
exit(failed == 0 ? 0 : 1)
