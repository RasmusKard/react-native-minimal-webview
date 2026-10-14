import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      // A creation-time setting: WebKit reads data detectors only from the configuration.
      MinimalWebViewHooks.configure["pageCounter"] = { configuration, _ in configuration.dataDetectorTypes = .phoneNumber }
      MinimalWebViewHooks.attach["pageCounter"] = { _, context in
        context.navigationDelegates.append(PageCounter(context: context))
        return nil
      }
      // Decision callbacks the core implements: these delegates take them over, and the app's props are not asked.
      MinimalWebViewHooks.attach["hookAuth"] = { _, context in
        context.navigationDelegates.append(HookAuth())
        return nil
      }
      MinimalWebViewHooks.attach["hookDialogs"] = { _, context in
        context.uiDelegates.append(HookDialogs(context: context))
        return nil
      }
    }
  }
}

/// Answers every HTTP basic or digest challenge itself.
private final class HookAuth: NSObject, WKNavigationDelegate {
  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let method = challenge.protectionSpace.authenticationMethod
    guard method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodHTTPDigest else {
      return completionHandler(.performDefaultHandling, nil)
    }
    completionHandler(.useCredential, URLCredential(user: "u", password: "p", persistence: .forSession))
  }
}

/// Answers every alert itself and reports it, instead of the core's dialog.
private final class HookDialogs: NSObject, WKUIDelegate {
  private weak var context: WebViewContext?

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor () -> Void
  ) {
    context?.emit("alert", ["message": message])
    completionHandler()
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
    context?.emit("pageLoaded", ["url": webView.url?.absoluteString ?? "", "count": count])
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    context?.emit("redirect", ["url": webView.url?.absoluteString ?? ""])
  }
}
