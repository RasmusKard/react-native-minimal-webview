import UIKit
import WebKit

/// Pull down at the top of the page to reload. Built only on the extension interface.
final class PullToRefresh: NSObject, WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private let control = UIRefreshControl()

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  func didCreate(_ webView: WKWebView) {
    control.addTarget(self, action: #selector(refresh), for: .valueChanged)
    webView.scrollView.refreshControl = control
  }

  @objc private func refresh() {
    host?.reload()
  }

  func didFinish(url: URL?) {
    control.endRefreshing()
  }
}
