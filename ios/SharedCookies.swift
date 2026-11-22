import WebKit

final class SharedCookies: NSObject, WKHTTPCookieStoreObserver {
  private weak var observed: WKHTTPCookieStore?
  private var copyScheduled = false
  private var copied: [HTTPCookie] = []

  func set(_ enabled: Bool, for store: WKHTTPCookieStore) {
    let next = enabled ? store : nil
    guard next !== observed else { return }
    observed?.remove(self)
    next?.add(self)
    observed = next
  }

  /// Calls `done` once the native cookies are in the WebView.
  func prepare(done: @escaping () -> Void) {
    guard let store = observed else { return done() }
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
      self.observed?.getAllCookies { [weak self] cookies in
        guard let self else { return }
        let key = { (cookie: HTTPCookie) in [cookie.name, cookie.domain, cookie.path] }
        let present = Set(cookies.map(key))
        self.copied.filter { !present.contains(key($0)) }.forEach(HTTPCookieStorage.shared.deleteCookie)
        cookies.forEach(HTTPCookieStorage.shared.setCookie)
        self.copied = cookies
      }
    }
  }
}
