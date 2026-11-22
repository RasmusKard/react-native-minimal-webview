import WebKit

final class SharedCookies: NSObject, WKHTTPCookieStoreObserver {
  private weak var store: WKHTTPCookieStore?
  private var enabled = false
  private var copyScheduled = false
  private var copied: [HTTPCookie] = []

  func didCreate(_ webView: WKWebView) {
    store = webView.configuration.websiteDataStore.httpCookieStore
  }

  func set(_ enabled: Bool) {
    guard enabled != self.enabled else { return }
    self.enabled = enabled
    if enabled { store?.add(self) } else { store?.remove(self) }
  }

  /// Calls `done` once the native cookies are in the WebView.
  func prepare(done: @escaping () -> Void) {
    guard enabled, let store else { return done() }
    let group = DispatchGroup()
    for cookie in HTTPCookieStorage.shared.cookies ?? [] {
      group.enter()
      store.setCookie(cookie) { group.leave() }
    }
    group.notify(queue: .main, execute: done)
  }

  func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    guard !copyScheduled else { return }
    copyScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.copyScheduled = false
      self.store?.getAllCookies { [weak self] cookies in
        guard let self else { return }
        let key = { (cookie: HTTPCookie) in [cookie.name, cookie.domain, cookie.path] }
        let present = Set(cookies.map(key))
        self.copied.filter { !present.contains(key($0)) }.forEach(HTTPCookieStorage.shared.deleteCookie)
        cookies.forEach(HTTPCookieStorage.shared.setCookie)
        self.copied = cookies
      }
    }
  }

  func detach() {
    store?.remove(self)
  }
}
