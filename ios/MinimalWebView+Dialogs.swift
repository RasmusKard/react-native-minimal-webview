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

  /// Camera and microphone. WebKit asks the OS itself, with the app's Info.plist strings; a grant from
  /// `onPermissionRequest` skips only WebKit's own prompt.
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
  ) {
    guard frame.isMainFrame else { return decisionHandler(.deny) }
    guard requestHandlers.contains("onPermissionRequest") else { return decisionHandler(.prompt) }
    let resources: [String] = switch type {
    case .camera: ["camera"]
    case .microphone: ["microphone"]
    default: ["camera", "microphone"]
    }
    asks.ask("core", "onPermissionRequest", ["origin": OriginRules.origin(of: origin), "resources": resources]) { answer in
      decisionHandler(answer as? Bool == true ? .grant : .deny)
    }
  }

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

  /// From the top of this view's window. A controller still presenting (one being dismissed) or itself being presented
  /// can't present: UIKit only logs it and the page would stay blocked, so the dialog is cancelled instead.
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
