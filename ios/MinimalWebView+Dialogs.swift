import UIKit
import WebKit

/// JS alert, confirm and prompt as UIAlertControllers. Android's WebChromeClient shows them by default.
/// WebKit requires each completion handler to be called exactly once, including when no dialog can be shown.
extension MinimalWebView: WKUIDelegate {
  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor () -> Void
  ) {
    let alert = UIAlertController(title: frame.securityOrigin.host, message: message, preferredStyle: .alert)
    alert.addAction(action("OK", .default) { completionHandler() })
    showDialog(alert, cancel: completionHandler)
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor (Bool) -> Void
  ) {
    let alert = UIAlertController(title: frame.securityOrigin.host, message: message, preferredStyle: .alert)
    alert.addAction(action("Cancel", .cancel) { completionHandler(false) })
    alert.addAction(action("OK", .default) { completionHandler(true) })
    showDialog(alert) { completionHandler(false) }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor (String?) -> Void
  ) {
    let alert = UIAlertController(title: frame.securityOrigin.host, message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(action("Cancel", .cancel) { completionHandler(nil) })
    alert.addAction(action("OK", .default) { [weak alert] in completionHandler(alert?.textFields?.first?.text ?? "") })
    showDialog(alert) { completionHandler(nil) }
  }

  /// Camera and microphone: an extension decides (permissions), otherwise WebKit prompts as usual.
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
  ) {
    guard frame.isMainFrame else { return decisionHandler(.deny) }
    let handled = activeExtensions?.contains { $0.requestMediaCapture(origin: origin, type: type, decide: decisionHandler) } == true
    if !handled { decisionHandler(.prompt) }
  }

  /// Dismisses the dialog on screen, if any, completing it as cancelled (teardown, crash, recreate).
  func dismissDialog() {
    guard let current = dialog else { return }
    dialog = nil
    current.controller.dismiss(animated: false)
    current.cancel()
  }

  private func action(_ title: String, _ style: UIAlertAction.Style, _ complete: @escaping () -> Void) -> UIAlertAction {
    UIAlertAction(title: title, style: style) { [weak self] _ in
      self?.dialog = nil
      complete()
    }
  }

  private func showDialog(_ alert: UIAlertController, cancel: @escaping () -> Void) {
    guard dialog == nil, window != nil, let presenter = appContext?.utilities?.currentViewController() else {
      return cancel()
    }
    dialog = (alert, cancel)
    presenter.present(alert, animated: true)
  }
}
