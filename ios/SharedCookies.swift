import WebKit

/// Shares login cookies between the WebView and native requests (URLSession, fetch): HTTPCookieStorage is copied into
/// the WebView when it is created, and the WebView's cookies are copied back after every page load.
/// (Android needs no extension: CookieManager is already shared app-wide.)
final class SharedCookies: WebViewExtension {
  private weak var webView: WKWebView?

  func didCreate(_ webView: WKWebView) {
    self.webView = webView
    let store = webView.configuration.websiteDataStore.httpCookieStore
    // ponytail: one setCookie per cookie; iOS 26's batch setCookies can replace this when the minimum allows
    for cookie in HTTPCookieStorage.shared.cookies ?? [] {
      store.setCookie(cookie)
    }
  }

  func didFinish(url: URL?) {
    webView?.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
      cookies.forEach(HTTPCookieStorage.shared.setCookie)
    }
  }
}
