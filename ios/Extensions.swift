import WebKit

/// A per-instance WebView extension. EXPERIMENTAL until the built-ins and one out-of-package extension use it.
/// Every hook has a no-op default. Enable one on a WebView with the `extensions` prop.
public protocol WebViewExtension: AnyObject {
  func attach(host: ExtensionHost, config: [String: Any])
  func didCreate(_ webView: WKWebView)
  func didFinish(url: URL?)
  func detach()
}

// Optional hooks: an extension implements only the ones it needs.
public extension WebViewExtension {
  func attach(host: ExtensionHost, config: [String: Any]) { /* optional */ }
  func didCreate(_ webView: WKWebView) { /* optional */ }
  func didFinish(url: URL?) { /* optional */ }
  func detach() { /* optional */ }
}

public protocol ExtensionHost: AnyObject {
  var webView: WKWebView? { get }
  func emit(_ event: String, _ payload: [String: Any])
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
