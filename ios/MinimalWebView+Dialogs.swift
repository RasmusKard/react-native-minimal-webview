import UIKit
import WebKit

/// WebKit requires each completion handler to be called exactly once, including when no dialog can be shown.
extension MinimalWebView: WKUIDelegate {
  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor () -> Void
  ) {
    let alert = UIAlertController(title: dialogTitle(frame), message: message, preferredStyle: .alert)
    alert.addAction(action("OK", .default) { completionHandler() })
    showDialog(alert, cancel: completionHandler)
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor (Bool) -> Void
  ) {
    let alert = UIAlertController(title: dialogTitle(frame), message: message, preferredStyle: .alert)
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
    let alert = UIAlertController(title: dialogTitle(frame), message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(action("Cancel", .cancel) { completionHandler(nil) })
    alert.addAction(action("OK", .default) { [weak alert] in completionHandler(alert?.textFields?.first?.text ?? "") })
    showDialog(alert) { completionHandler(nil) }
  }

  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
  ) {
    let requester = OriginRules.origin(of: origin)
    guard frame.isMainFrame, requester != "null" else { return decisionHandler(.deny) }
    guard requestHandlers.contains("onPermissionRequest") else { return decisionHandler(.prompt) }
    let resources: [String] = switch type {
    case .camera: ["camera"]
    case .microphone: ["microphone"]
    default: ["camera", "microphone"]
    }
    asks.ask("core", "onPermissionRequest", ["origin": requester, "resources": resources]) { answer in
      decisionHandler(answer as? Bool == true ? .grant : .deny)
    }
  }

  private func dialogTitle(_ frame: WKFrameInfo) -> String {
    let host = frame.securityOrigin.host
    return host.isEmpty ? "JavaScript" : host
  }

  func dismissDialog() {
    guard let current = dialog else { return }
    dialog = nil
    current.controller.dismiss(animated: false)
    current.cancel()
  }

  private func action(_ title: String, _ style: UIAlertAction.Style, _ complete: @escaping () -> Void) -> UIAlertAction {
    UIAlertAction(title: title, style: style) { [weak self] action in
      // UIKit runs this after the dismissal animation, by when an unmount or a crash may have completed the dialog.
      guard let self, dialog?.controller.actions.contains(action) == true else { return }
      dialog = nil
      complete()
    }
  }

  /// UIKit only logs a present from a controller that has a presented one or is being presented.
  private func showDialog(_ alert: UIAlertController, cancel: @escaping () -> Void) {
    var top = window?.rootViewController
    while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
    guard dialog == nil, let presenter = top, presenter.presentedViewController == nil, !presenter.isBeingPresented else {
      return cancel()
    }
    dialog = (alert, cancel)
    presenter.present(alert, animated: true)
  }
}
