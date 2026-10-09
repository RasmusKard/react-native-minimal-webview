import WebKit

/// Bridge transport: page -> RN through a WKScriptMessageHandlerWithReply, RN -> page through callAsyncJavaScript.
extension MinimalWebView {
  func bridgeReceive(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    let origin = OriginRules.origin(of: message.frameInfo.securityOrigin)
    guard message.frameInfo.isMainFrame, OriginRules.allows(bridgeOrigins, origin), let text = message.body as? String else {
      return replyHandler(nil, "origin not allowed")
    }
    // `*` allows every document, opaque ones too (whose location.origin is "null"): nothing to compare.
    bridgeOrigin = bridgeOrigins.contains("*") ? "*" : origin
    if let header = Self.header(text), header.kind == "call" {
      pendingReplies[header.id] = replyHandler
    } else {
      replyHandler(nil, nil)
    }
    onBridge(["message": text])
  }

  /// Answers a pending page call through its reply handler, or delivers a call or event to the page.
  func bridgePost(_ text: String) {
    if let header = Self.header(text), header.kind == "result" || header.kind == "error" {
      // An answer to a call of a page that is gone has nobody to go to: drop it.
      pendingReplies.removeValue(forKey: header.id)?(text, nil)
      return
    }
    // Only to the allowed document that last posted (its page client says `ready` first). The page checks its origin
    // again at delivery time: the document may have changed since the post was queued.
    guard let bridgeOrigin else { return }
    let deliver = "return origin === '*' || location.origin === origin ? await window.nativeBridge?.__receive(message) : null"
    webView?.callAsyncJavaScript(deliver, arguments: ["message": text, "origin": bridgeOrigin], in: nil, in: .page) { [weak self] result in
      if case .success(let reply) = result, let reply = reply as? String {
        self?.onBridge(["message": reply])
      }
    }
  }

  func failPendingReplies() {
    let waiting = pendingReplies.values
    pendingReplies.removeAll()
    waiting.forEach { $0(nil, "navigated") }
  }

  private static func header(_ text: String) -> (kind: String, id: String)? {
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let kind = object["kind"] as? String, let id = object["id"] as? String else { return nil }
    return (kind, id)
  }

}

/// Holds the view weakly: WKUserContentController retains its handlers.
final class WeakBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
  weak var view: MinimalWebView?

  init(_ view: MinimalWebView) {
    self.view = view
  }

  func userContentController(
    _ controller: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor (Any?, String?) -> Void
  ) {
    guard let view else { return replyHandler(nil, "gone") }
    view.bridgeReceive(message, replyHandler: replyHandler)
  }
}
