import WebKit

/// Bridge transport: page -> RN through a WKScriptMessageHandlerWithReply, RN -> page through callAsyncJavaScript.
extension MinimalWebView {
  func bridgeReceive(_ message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard message.frameInfo.isMainFrame, originAllowed(message.frameInfo.securityOrigin), let text = message.body as? String else {
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
    if let header = Self.header(text), header.kind == "result" || header.kind == "error",
      let reply = pendingReplies.removeValue(forKey: header.id) {
      return reply(text, nil)
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

  /// Same rule format as originAllowed and the page client.
  private static let deliver = """
    const o = location.origin;
    const ok = origins.some((r) => {
      const [scheme, host] = r.split('://*.');
      return host === undefined ? r === '*' || r === o : o.startsWith(scheme + '://') && o.endsWith('.' + host);
    });
    return ok ? await window.nativeBridge?.__receive(message) : null;
    """

  private static func header(_ text: String) -> (kind: String, id: String)? {
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let kind = object["kind"] as? String, let id = object["id"] as? String else { return nil }
    return (kind, id)
  }

  /// Origin rules in Android's format: `https://example.com`, `https://*.example.com`, `http://localhost:8090`.
  private func originAllowed(_ origin: WKSecurityOrigin) -> Bool {
    let value = "\(origin.protocol)://\(origin.host)" + (origin.port == 0 ? "" : ":\(origin.port)")
    return bridgeOrigins.contains { rule in
      guard let wildcard = rule.range(of: "://*.") else { return rule == "*" || rule == value }
      return value.hasPrefix(rule[..<wildcard.lowerBound] + "://") && value.hasSuffix("." + rule[wildcard.upperBound...])
    }
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
