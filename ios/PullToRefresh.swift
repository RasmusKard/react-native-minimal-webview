import UIKit
import WebKit

/// Pull down at the top of the page to reload. Built only on the extension interface.
final class PullToRefresh: NSObject, WebViewExtension {
  private weak var webView: WKWebView?
  private let control = UIRefreshControl()

  func didCreate(_ webView: WKWebView) {
    self.webView = webView
    control.addTarget(self, action: #selector(refresh), for: .valueChanged)
    webView.scrollView.refreshControl = control
  }

  @objc private func refresh() {
    webView?.reload()
  }

  func didFinish(url: URL?) {
    control.endRefreshing()
  }
}
