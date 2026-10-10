import WebKit

/// Bridge transport: page -> RN through a WKScriptMessageHandler, RN -> page through callAsyncJavaScript. Native only
/// moves the text; the protocol (calls, results, events) is the page client's and createBridge's.
extension MinimalWebView {
  func bridgeReceive(_ message: WKScriptMessage) {
    let origin = OriginRules.origin(of: message.frameInfo.securityOrigin)
    guard message.frameInfo.isMainFrame, OriginRules.allows(bridgeOrigins, origin), let text = message.body as? String else { return }
    // `*` allows every document, opaque ones too (whose location.origin is "null"): nothing to compare.
    bridgeOrigin = bridgeOrigins.contains("*") ? "*" : origin
    onBridge(["message": text])
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
