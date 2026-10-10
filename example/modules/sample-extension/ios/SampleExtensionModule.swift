import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate { WebViewExtensions.register("pageCounter") { PageCounter() } }
  }
}

/// Uses only the public extension protocol: no access to the WebView's internals.
private final class PageCounter: WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private var count = 0

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  // A creation-time setting: WebKit reads data detectors only from the configuration.
  func configure(_ configuration: WKWebViewConfiguration) {
    configuration.dataDetectorTypes = .phoneNumber
  }

  func didFinish(url: URL?) {
    count += 1
    host?.webView?.evaluateJavaScript("window.__pageCount = \(count);")
    host?.emit("pageLoaded", ["url": url?.absoluteString ?? "", "count": count])
  }
}
