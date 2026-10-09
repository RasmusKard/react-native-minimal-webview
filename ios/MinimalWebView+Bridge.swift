import WebKit

/// Bridge transport: page -> RN through a WKScriptMessageHandlerWithReply, RN -> page through callAsyncJavaScript.
extension MinimalWebView {
  func bridgeReceive(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    let origin = OriginRules.origin(of: message.frameInfo.securityOrigin)
    guard message.frameInfo.isMainFrame, OriginRules.allows(bridgeOrigins, origin), let text = message.body as? String else {
      return replyHandler(nil, "origin not allowed")
    }
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
    // The origin check runs in the page at delivery time: the document may have changed since the post was queued.
    webView?.callAsyncJavaScript(Self.deliver, arguments: ["message": text, "origins": bridgeOrigins], in: nil, in: .page) { [weak self] result in
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

  /// Same rule format as OriginRules and the page client.
  private static let deliver = #"""
    const parse = (text) => {
      const m = /^(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(text.toLowerCase());
      return m && { scheme: m[1], wildcard: !!m[2], host: m[3], port: +(m[4] ?? (m[1] === 'https' ? 443 : 80)) };
    };
    const o = parse(location.origin);
    const ok = origins.some((rule) => {
      const r = parse(rule);
      if (!r || !o || o.wildcard) return rule === '*';
      return (r.wildcard ? o.host.endsWith('.' + r.host) : o.host === r.host) && r.scheme === o.scheme && r.port === o.port;
    });
    return ok ? await window.nativeBridge?.__receive(message) : null;
    """#

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
