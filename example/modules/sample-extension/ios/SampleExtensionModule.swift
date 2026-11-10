import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      // `configure` gets the configuration before the WKWebView exists: WebKit reads data detectors only from it.
      MinimalWebViewHooks.register("sample.pageCounter", configure: { configuration, _ in
        configuration.dataDetectorTypes = .phoneNumber
      }) { webView, context in
        let counter = PageCounter(context: context)
        context.navigationDelegates.append(counter)
        // The extension's `options` arrive at once, then live on each change, with no reload.
        context.onOptions { [weak webView] options in
          counter.global = (options as? [String: Any])?["global"] as? String ?? "__pageCount"
          if let webView { counter.stamp(webView) }
        }
        // Answers JS's `ref.hook('sample.pageCounter', 'count')`.
        context.handle("count") { _, reply in reply(counter.count) }
        // A handler can reply later, here with the app's answer to an ask, and fail the JS call when there is none.
        context.handle("label") { _, reply in
          context.ask("label", ["count": counter.count]) { answer in
            if let answer { reply(answer) } else { reply.fail("the app gave no label") }
          }
        }
        context.onDocumentEnd { reason in
          guard reason != .closing else { return }
          context.emit("documentEnd", ["reason": "\(reason)", "url": context.url])
        }
      }
      // Page requests only a hook can take over (the harness's fixtures): HTTP auth and the alert panel.
      MinimalWebViewHooks.register("sample.hookAuth") { _, context in
        context.navigationDelegates.append(HookAuth(context: context))
      }
      MinimalWebViewHooks.register("sample.hookDialogs") { _, context in
        context.uiDelegates.append(HookDialogs(context: context))
      }
      // Takes the navigation decision from the app's navigationRules, which a `core.warning` says.
      MinimalWebViewHooks.register("sample.hookNavigation") { _, context in
        context.navigationDelegates.append(HookNavigation())
      }
      // Each WebView that enables this hook is made from its subclass; others stay plain WKWebViews.
      MinimalWebViewHooks.register("sample.subclass", webViewClass: SampleWKWebView.self) { webView, context in
        let name = String(describing: type(of: webView))
        context.handle("class") { _, reply in reply(name) }
      }
      PerfProbe.register()
      // The refresh control exists before `pullToRefresh` shows it, so it can be styled at attach.
      MinimalWebViewHooks.register("sample.seams") { webView, context in
        context.refreshControl?.tintColor = .white
        context.handle("tint") { [weak webView] _, reply in reply(webView?.scrollView.refreshControl?.tintColor == .white) }
        context.onDestroyed { reason in if reason == .closing { Seams.closed += 1 } }
      }
    }
    // The perf suite's frame-gap probe (PerfProbe.swift): module functions, so they work without a hook too.
    AsyncFunction("closedViews") { Seams.closed }.runOnQueue(.main)
    AsyncFunction("stallStart") { Stall.shared.start() }.runOnQueue(.main)
    AsyncFunction("stallStop") { Stall.shared.stop() }.runOnQueue(.main)
  }
}

/// `sample.seams`: how many of its views were closed at unmount.
private enum Seams {
  static var closed = 0
}

/// The `sample.subclass` hook's class: an override of what WKWebView lets a subclass change would go here.
private final class SampleWKWebView: WKWebView {}

/// The hosts HookAuth gives credentials to: only the test pages server (`PAGES` in App.tsx).
private let authHosts: Set<String> = ["localhost"]

/// Answers HTTP basic or digest challenges from authHosts itself, and cancels the rest. Sends `challenge` for each
/// challenge it gets.
private final class HookAuth: NSObject, WKNavigationDelegate {
  private let context: WebViewContext

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    let method = space.authenticationMethod
    context.emit("challenge", ["method": method, "host": space.host])
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

/// Loads every navigation in place.
private final class HookNavigation: NSObject, WKNavigationDelegate {
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(.allow)
  }
}

/// Answers every alert itself and reports it, instead of the core's dialog.
private final class HookDialogs: NSObject, WKUIDelegate {
  private let context: WebViewContext

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor () -> Void
  ) {
    context.emit("alert", ["message": message])
    completionHandler()
  }
}

/// Counts page loads through two delegate callbacks: `didFinish`, which the core implements and fans out, and
/// `didReceiveServerRedirect`, which it doesn't and forwards. Its option, `true` or `{ global: name }`, names the
/// page's global that gets the count (`__pageCount` by default).
private final class PageCounter: NSObject, WKNavigationDelegate {
  private let context: WebViewContext
  private(set) var count = 0
  var global = "__pageCount"

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    count += 1
    stamp(webView)
    context.emit("pageLoaded", ["url": webView.url?.absoluteString ?? "", "count": count])
  }

  func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
    context.emit("redirect", ["url": webView.url?.absoluteString ?? ""])
  }

  func stamp(_ webView: WKWebView) {
    webView.callAsyncJavaScript("window[name] = count", arguments: ["name": global, "count": count], in: nil, in: .page)
  }
}
