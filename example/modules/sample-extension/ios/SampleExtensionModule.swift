import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      // configure: a creation-time setting; WebKit reads data detectors only from the configuration.
      MinimalWebViewHooks.register("sample.pageCounter", configure: { configuration, _ in
        configuration.dataDetectorTypes = .phoneNumber
      }) { webView, context in
        let counter = PageCounter(context: context)
        context.navigationDelegates.append(counter)
        // A live option: the page gets the count under the new name at once, without a reload.
        context.onOptionsChange { [weak webView] _ in if let webView { counter.stamp(webView) } }
        // JS's `ref.hook('sample.pageCounter', 'count')`.
        context.handle("count") { _, reply in reply(counter.count) }
        // `ref.hook('sample.pageCounter', 'label')`: asks the app for the count's label and replies with its answer.
        context.handle("label") { [weak context] _, reply in context?.ask("label", ["count": counter.count], reply) }
        context.onDocumentEnd { [weak context] reason in
          guard let context, reason != .closing else { return }
          context.emit("documentEnd", ["reason": "\(reason)", "url": context.url])
        }
        return nil
      }
      // Fixtures for the harness: decision callbacks the core implements, which these delegates take over, so the
      // app's props are not asked.
      MinimalWebViewHooks.register("sample.hookAuth") { _, context in
        context.navigationDelegates.append(HookAuth())
        return nil
      }
      MinimalWebViewHooks.register("sample.hookDialogs") { _, context in
        context.uiDelegates.append(HookDialogs(context: context))
        return nil
      }
    }
  }
}

/// The hosts HookAuth gives credentials to: only the test pages server (`PAGES` in App.tsx).
private let authHosts: Set<String> = ["localhost"]

/// Answers HTTP basic or digest challenges from authHosts itself, and cancels the rest.
private final class HookAuth: NSObject, WKNavigationDelegate {
  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    let method = space.authenticationMethod
    guard method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodHTTPDigest else {
      return completionHandler(.performDefaultHandling, nil)
    }
    // Plain http only to the loopback test server, which no network sees.
    guard authHosts.contains(space.host), space.receivesCredentialSecurely || space.host == "localhost" else {
      return completionHandler(.cancelAuthenticationChallenge, nil)
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
/// `didReceiveServerRedirect`, which it doesn't and forwards. Its option, `true` or `{ global: name }`, names the
/// page's global that gets the count (`__pageCount` by default).
private final class PageCounter: NSObject, WKNavigationDelegate {
  private weak var context: WebViewContext?
  private(set) var count = 0

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    count += 1
    stamp(webView)
    context?.emit("pageLoaded", ["url": webView.url?.absoluteString ?? "", "count": count])
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    context?.emit("redirect", ["url": webView.url?.absoluteString ?? ""])
  }

  func stamp(_ webView: WKWebView) {
    let global = (context?.options as? [String: Any])?["global"] as? String ?? "__pageCount"
    webView.callAsyncJavaScript("window[name] = count", arguments: ["name": global, "count": count], in: nil, in: .page)
  }
}
