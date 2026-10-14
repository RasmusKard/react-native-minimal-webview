import UIKit

/// Pull down at the top of the page to reload (the `pullToRefresh` prop): a UIRefreshControl on the scroll view.
final class PullToRefresh: NSObject {
  private let control = UIRefreshControl()
  private let reload: () -> Void

  init(reload: @escaping () -> Void) {
    self.reload = reload
    super.init()
    control.addTarget(self, action: #selector(refresh), for: .valueChanged)
  }

  /// Puts the control on `scrollView`, or takes it off.
  func set(_ enabled: Bool, on scrollView: UIScrollView) {
    let wanted: UIRefreshControl? = enabled ? control : nil
    if scrollView.refreshControl !== wanted { scrollView.refreshControl = wanted }
  }

  /// A load ended, finished or failed: the spinner stops, or it would ignore the next pull.
  func loadEnded() {
    control.endRefreshing()
  }

  @objc private func refresh() {
    reload()
  }
}
