import WebKit

/// A per-instance WebView extension. EXPERIMENTAL until the built-ins and one out-of-package extension use it.
/// Every hook has a no-op default. Enable one on a WebView with the `extensions` prop. For the decide hooks, the first
/// extension that handles a request wins.
public protocol WebViewExtension: AnyObject {
  func attach(host: ExtensionHost, config: [String: Any])
  func didCreate(_ webView: WKWebView)
  func didFinish(url: URL?)
  /// Return `.download` (or another policy) to override the default `.allow` for a main-frame response.
  func decidePolicy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy?
  /// Whether a navigation WebKit marks as a download (`<a download>`, blob:) should become one.
  func wantsDownload(_ action: WKNavigationAction) -> Bool
  func didBecome(_ download: WKDownload)
  /// Return true to handle the request; `decide` must then be called once.
  func requestMediaCapture(origin: WKSecurityOrigin, type: WKMediaCaptureType, decide: @escaping (WKPermissionDecision) -> Void) -> Bool
  func detach()
}

// Optional hooks: an extension implements only the ones it needs.
public extension WebViewExtension {
  func attach(host: ExtensionHost, config: [String: Any]) { /* optional */ }
  func didCreate(_ webView: WKWebView) { /* optional */ }
  func didFinish(url: URL?) { /* optional */ }
  func decidePolicy(for response: WKNavigationResponse) -> WKNavigationResponsePolicy? { nil }
  func wantsDownload(_ action: WKNavigationAction) -> Bool { false }
  func didBecome(_ download: WKDownload) { /* optional */ }
  func requestMediaCapture(origin: WKSecurityOrigin, type: WKMediaCaptureType, decide: @escaping (WKPermissionDecision) -> Void) -> Bool { false }
  func detach() { /* optional */ }
}

public protocol ExtensionHost: AnyObject {
  var webView: WKWebView? { get }
  func emit(_ event: String, _ payload: [String: Any])
  /// Async decide hook: emits `event` to the extension's JS `onEvent` and calls `onAnswer` with its result (nil if the view goes away).
  func ask(_ event: String, _ payload: [String: Any], onAnswer: @escaping (Any?) -> Void)
  /// The core's reload: retries the failed URL after an error.
  func reload()
}

/// Third-party packages call `WebViewExtensions.register("name") { MyExtension() }` from their module's OnCreate.
public enum WebViewExtensions {
  private static var factories: [String: () -> WebViewExtension] = [:]

  public static func register(_ name: String, factory: @escaping () -> WebViewExtension) {
    factories[name] = factory
  }

  static func create(_ name: String) -> WebViewExtension? {
    factories[name]?()
  }
}
