import MinimalWebView
import WebKit

/// The hook behind the `onDialog` prop: each alert, confirm and prompt is an ask, which the page waits for.
enum Dialogs {
  static let key = "minimal-rn-webview-extensions.dialogs"

  static func register() {
    MinimalWebViewHooks.register(key) { _, context in
      let delegate = Delegate(context)
      // A listed delegate takes every dialog: listed only while the prop is set, so the core's dialogs come back.
      let list = { [weak context] (on: Bool) in
        context?.uiDelegates.removeAll { $0 === delegate }
        if on { context?.uiDelegates.append(delegate) }
      }
      list(true)
      context.onOptionsChange { list($0 != nil) }
      return nil
    }
  }

  private final class Delegate: NSObject, WKUIDelegate {
    // Weak: the context holds the handler that holds this delegate.
    private weak var context: WebViewContext?

    init(_ context: WebViewContext) {
      self.context = context
    }

    func webView(
      _ webView: WKWebView,
      runJavaScriptAlertPanelWithMessage message: String,
      initiatedByFrame frame: WKFrameInfo,
      completionHandler: @escaping @MainActor () -> Void
    ) {
      ask(webView, "alert", (message, nil), frame) { _ in completionHandler() }
    }

    func webView(
      _ webView: WKWebView,
      runJavaScriptConfirmPanelWithMessage message: String,
      initiatedByFrame frame: WKFrameInfo,
      completionHandler: @escaping @MainActor (Bool) -> Void
    ) {
      ask(webView, "confirm", (message, nil), frame) { completionHandler($0 as? Bool == true) }
    }

    func webView(
      _ webView: WKWebView,
      runJavaScriptTextInputPanelWithPrompt prompt: String,
      defaultText: String?,
      initiatedByFrame frame: WKFrameInfo,
      completionHandler: @escaping @MainActor (String?) -> Void
    ) {
      ask(webView, "prompt", (prompt, defaultText), frame) { completionHandler($0 as? String) }
    }

    private func ask(
      _ webView: WKWebView, _ type: String, _ text: (message: String, defaultValue: String?), _ frame: WKFrameInfo,
      _ onAnswer: @escaping (Any?) -> Void
    ) {
      guard let context else { return onAnswer(nil) }
      let payload: [String: Any] = [
        "message": text.message, "defaultValue": text.defaultValue ?? NSNull(),
        "url": frame.request.url?.absoluteString ?? "", "isTopFrame": frame.isMainFrame
      ]
      // As the core does for its own dialogs: an accessibility query into the blocked page hangs until the answer.
      webView.accessibilityElementsHidden = true
      context.ask(type, payload) { [weak webView] answer in
        webView?.accessibilityElementsHidden = false
        onAnswer(answer)
      }
    }
  }
}
