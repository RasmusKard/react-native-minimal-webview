import ExpoModulesCore
import WebKit

extension MinimalWebView {
  func installScripts(_ controller: WKUserContentController) {
    // WebKit can only remove every script.
    let hooks = controller.userScripts.filter { script in !ownScripts.contains { $0 === script } }
    controller.removeAllUserScripts()
    ownScripts = []
    if let bridgeScript {
      ownScripts.append(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }
    for script in injectedScripts {
      guard let code = script.code else { continue }
      ownScripts.append(WKUserScript(source: code, injectionTime: .atDocumentStart, forMainFrameOnly: script.allFrames != true, in: .page))
    }
    (ownScripts + hooks).forEach { controller.addUserScript($0) }
  }

  /// WebKit settles a call whose page went away seconds later or never.
  func evaluate(_ script: String, _ promise: Promise) {
    guard let webView else { return promise.reject("unavailable", "No WebView") }
    let id = nextEvaluation
    nextEvaluation += 1
    evaluations[id] = promise
    let body = "return ((v) => { try { return JSON.stringify(v) ?? 'null' } catch { return 'null' } })(await (\n\(script)\n))"
    webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { [weak self] result in
      guard let promise = self?.evaluations.removeValue(forKey: id) else { return }
      switch result {
      case .success(let value): promise.resolve(value as? String ?? "null")
      case .failure(let error):
        // WebKit's localizedDescription is generic.
        let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
        // WebKit drops the call of a page being left, and (iOS 27) can say so before didCommit.
        if message == Self.unreachable, self?.webView?.isLoading == true { return promise.reject("navigated", Self.navigated) }
        promise.reject("script_error", message)
      }
    }
  }

  func failEvaluations() {
    let waiting = evaluations.values
    evaluations = [:]
    waiting.forEach { $0.reject("navigated", Self.navigated) }
  }

  private static let navigated = "the page navigated before the script finished"
  private static let unreachable = "Completion handler for function call is no longer reachable"

  func bridgeReceive(_ message: WKScriptMessage) {
    let origin = OriginRules.origin(of: message.frameInfo.securityOrigin)
    // A window.open('') view (WindowCatcher) shares the content controller.
    guard message.webView === webView, message.frameInfo.isMainFrame, OriginRules.allows(bridgeOrigins, origin),
      let text = message.body as? String else { return }
    bridgeOrigin = bridgeOrigins.contains("*") ? "*" : origin
    onBridge(["message": text, "origin": origin])
  }

  func bridgePost(_ text: String) {
    guard let bridgeOrigin else { return }
    let deliver = "if (origin === '*' || location.origin === origin) window.nativeBridge?.__receive(message)"
    webView?.callAsyncJavaScript(deliver, arguments: ["message": text, "origin": bridgeOrigin], in: nil, in: .page)
  }
}

/// WKUserContentController retains its handlers.
final class WeakBridgeHandler: NSObject, WKScriptMessageHandler {
  weak var view: MinimalWebView?

  init(_ view: MinimalWebView) {
    self.view = view
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    view?.bridgeReceive(message)
  }
}
