import WebKit

/// The scripts the view runs in the page: the injected scripts, `evaluate`, and the bridge transport (page -> RN through a
/// WKScriptMessageHandler, RN -> page through callAsyncJavaScript). The bridge moves only the text, with the sender's
/// verified origin; the protocol (calls, results, events) is the page client's and createBridge's.
extension MinimalWebView {
  /// The bridge's page client first, then the app's scripts in order, then the hooks' own. Changes take effect from the
  /// next navigation.
  func installScripts(_ controller: WKUserContentController) {
    // WebKit can only remove every script: take the hooks' out and add them back after the core's.
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
    installedScripts = injectedScripts.map { $0.toDictionary() } as NSArray
  }

  /// The `evaluate` ref method. A new document rejects what is still waiting: WebKit settles a call whose page went
  /// away seconds later or never.
  func evaluate(_ script: String, onResult: @escaping (Result<String, EvaluateError>) -> Void) {
    guard let webView else { return onResult(.failure(EvaluateError(code: "unavailable", message: "No WebView"))) }
    let id = nextEvaluation
    nextEvaluation += 1
    evaluations[id] = onResult
    let body = "return ((v) => { try { return JSON.stringify(v) ?? 'null' } catch { return 'null' } })(await (\n\(script)\n))"
    webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { [weak self] result in
      // Already rejected when its page went away.
      guard let onResult = self?.evaluations.removeValue(forKey: id) else { return }
      switch result {
      case .success(let value): onResult(.success(value as? String ?? "null"))
      case .failure(let error):
        // The thrown error's own text, as on Android; WebKit's localizedDescription is generic.
        let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
        onResult(.failure(EvaluateError(code: "script_error", message: message)))
      }
    }
  }

  /// The page the waiting `evaluate` calls run in is gone.
  func failEvaluations() {
    let waiting = evaluations.values
    evaluations = [:]
    waiting.forEach { $0(.failure(EvaluateError(code: "navigated", message: "the page navigated before the script finished"))) }
  }

  func bridgeReceive(_ message: WKScriptMessage) {
    let origin = OriginRules.origin(of: message.frameInfo.securityOrigin)
    // This view's main frame only: a window.open('') view (WindowCatcher) shares the content controller.
    guard message.webView === webView, message.frameInfo.isMainFrame, OriginRules.allows(bridgeOrigins, origin),
      let text = message.body as? String else { return }
    // `*` allows every document, opaque ones too (whose location.origin is "null"): nothing to compare.
    bridgeOrigin = bridgeOrigins.contains("*") ? "*" : origin
    onBridge(["message": text, "origin": origin])
  }

  /// Delivers a message from RN to the page. Only to the allowed document that last posted (its page client says
  /// `ready` first). The page checks its origin again at delivery time: the document may have changed since the post
  /// was queued. A message for a page that is gone is dropped.
  func bridgePost(_ text: String) {
    guard let bridgeOrigin else { return }
    let deliver = "if (origin === '*' || location.origin === origin) window.nativeBridge?.__receive(message)"
    webView?.callAsyncJavaScript(deliver, arguments: ["message": text, "origin": bridgeOrigin], in: nil, in: .page)
  }
}

struct EvaluateError: Error {
  let code: String
  let message: String
}

/// Holds the view weakly: WKUserContentController retains its handlers.
final class WeakBridgeHandler: NSObject, WKScriptMessageHandler {
  weak var view: MinimalWebView?

  init(_ view: MinimalWebView) {
    self.view = view
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    view?.bridgeReceive(message)
  }
}

extension OriginRules {
  /// The origin as `location.origin` writes it, so the bridge can compare the two exactly. Kept out of OriginRules.swift
  /// so that file builds without WebKit (the rule tests run on Linux).
  static func origin(of security: WKSecurityOrigin) -> String {
    origin(security.protocol, security.host, security.port)
  }
}
