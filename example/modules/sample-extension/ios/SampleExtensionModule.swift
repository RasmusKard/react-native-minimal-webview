import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      // A creation-time setting: WebKit reads data detectors only from the configuration.
      MinimalWebViewHooks.configure.append { configuration, context in
        if context.options["pageCounter"] != nil { configuration.dataDetectorTypes = .phoneNumber }
      }
      MinimalWebViewHooks.attach.append { _, context in
        guard context.options["pageCounter"] != nil else { return nil }
        context.navigationDelegates.append(PageCounter(context: context))
        return nil
      }
    }
  }
}

/// Counts page loads through two delegate callbacks: `didFinish`, which the core implements and fans out, and
/// `didReceiveServerRedirect`, which it doesn't and forwards.
private final class PageCounter: NSObject, WKNavigationDelegate {
  private weak var context: WebViewContext?
  private var count = 0

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    count += 1
    webView.evaluateJavaScript("window.__pageCount = \(count)")
    context?.emit("pageCounter.pageLoaded", ["url": webView.url?.absoluteString ?? "", "count": count])
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    context?.emit("pageCounter.redirect", ["url": webView.url?.absoluteString ?? ""])
  }
}
