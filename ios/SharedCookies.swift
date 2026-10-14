import WebKit

/// Shares login cookies between the WebView and native requests (URLSession, fetch) when the `sharedCookies` prop is
/// set: HTTPCookieStorage is copied into the WebView before each `source` load, and the WebView's cookie changes
/// (including ones set by XHR and fetch) are copied back as they happen. (Android needs nothing: CookieManager is
/// already shared app-wide.)
final class SharedCookies: NSObject, WKHTTPCookieStoreObserver {
  private weak var store: WKHTTPCookieStore?
  private var enabled = false
  private var copyScheduled = false

  func didCreate(_ webView: WKWebView) {
    store?.remove(self)
    store = webView.configuration.websiteDataStore.httpCookieStore
    if enabled { store?.add(self) }
  }

  func set(_ enabled: Bool) {
    guard enabled != self.enabled else { return }
    self.enabled = enabled
    if enabled { store?.add(self) } else { store?.remove(self) }
  }

  /// Work that must finish before a `source` load: calls `done` once the native cookies are in the WebView.
  func prepare(_ webView: WKWebView, done: @escaping () -> Void) {
    guard enabled else { return done() }
    let store = webView.configuration.websiteDataStore.httpCookieStore
    let group = DispatchGroup()
    // ponytail: one setCookie per cookie; iOS 26's batch setCookies can replace this when the minimum allows
    for cookie in HTTPCookieStorage.shared.cookies ?? [] {
      group.enter()
      store.setCookie(cookie) { group.leave() }
    }
    group.notify(queue: .main, execute: done)
  }

  /// One copy per main-queue turn: `prepare`'s setCookie calls, or a page setting many cookies, each fire this.
  func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    guard !copyScheduled else { return }
    copyScheduled = true
    DispatchQueue.main.async { [weak self] in
      // Cleared before the read: a change after it schedules the next copy.
      self?.copyScheduled = false
      self?.store?.getAllCookies { cookies in
        cookies.forEach(HTTPCookieStorage.shared.setCookie)
      }
    }
  }

  func detach() {
    store?.remove(self)
  }
}
