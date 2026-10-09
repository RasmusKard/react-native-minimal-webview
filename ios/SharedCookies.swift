import WebKit

/// Shares login cookies between the WebView and native requests (URLSession, fetch). HTTPCookieStorage is copied into the
/// WebView before each `source` load, and the WebView's cookie changes (including ones set by XHR and fetch) are copied
/// back as they happen. (Android needs no extension: CookieManager is already shared app-wide.)
final class SharedCookies: NSObject, WebViewExtension, WKHTTPCookieStoreObserver {
  private weak var store: WKHTTPCookieStore?

  func didCreate(_ webView: WKWebView) {
    store?.remove(self)
    store = webView.configuration.websiteDataStore.httpCookieStore
    store?.add(self)
  }

  func prepare(_ webView: WKWebView, done: @escaping () -> Void) {
    let store = webView.configuration.websiteDataStore.httpCookieStore
    let group = DispatchGroup()
    // ponytail: one setCookie per cookie; iOS 26's batch setCookies can replace this when the minimum allows
    for cookie in HTTPCookieStorage.shared.cookies ?? [] {
      group.enter()
      store.setCookie(cookie) { group.leave() }
    }
    group.notify(queue: .main, execute: done)
  }

  func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    cookieStore.getAllCookies { cookies in
      cookies.forEach(HTTPCookieStorage.shared.setCookie)
    }
  }

  func detach() {
    store?.remove(self)
  }
}
