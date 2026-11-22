import ExpoModulesCore
import MinimalWebView
import WebKit

public class SampleExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      MinimalWebViewHooks.register("sample.pageCounter", configure: { configuration, _ in
        configuration.dataDetectorTypes = .phoneNumber
      }) { webView, context in
        let counter = PageCounter(context: context)
        context.navigationDelegates.append(counter)
        context.onOptions { [weak webView] options in
          counter.global = (options as? [String: Any])?["global"] as? String ?? "__pageCount"
          if let webView { counter.stamp(webView) }
        }
        context.handle("count") { _, reply in reply(counter.count) }
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
      MinimalWebViewHooks.register("sample.hookAuth") { _, context in
        context.navigationDelegates.append(HookAuth(context: context))
      }
      MinimalWebViewHooks.register("sample.hookDialogs") { _, context in
        context.uiDelegates.append(HookDialogs(context: context))
      }
      MinimalWebViewHooks.register("sample.hookNavigation") { _, context in
        context.navigationDelegates.append(HookNavigation())
      }
      MinimalWebViewHooks.register("sample.subclass", webViewClass: SampleWKWebView.self) { webView, context in
        let name = String(describing: type(of: webView))
        context.handle("class") { _, reply in reply(name) }
      }
      PerfProbe.register()
      MinimalWebViewHooks.register("sample.seams") { webView, context in
        context.refreshControl?.tintColor = .white
        context.handle("tint") { [weak webView] _, reply in reply(webView?.scrollView.refreshControl?.tintColor == .white) }
        context.handle("twice") { args, reply in reply((args.first as? Double).map { $0 * 2 }) }
        context.onDestroyed { reason in if reason == .closing { Seams.closed += 1 } }
      }
    }
    AsyncFunction("closedViews") { Seams.closed }.runOnQueue(.main)
    AsyncFunction("adsRegisteredAt") { MobileAdsStandIn.sharedInstance.registeredAt }.runOnQueue(.main)
    AsyncFunction("stallStart") { Stall.shared.start() }.runOnQueue(.main)
    AsyncFunction("stallStop") { Stall.shared.stop() }.runOnQueue(.main)
    AsyncFunction("tapAlert") { (title: String) in tapAlert(title) }.runOnQueue(.main)
  }
}

private func tapAlert(_ title: String) -> Bool {
  let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
  var top = window?.rootViewController
  while let next = top?.presentedViewController { top = next }
  // UIKit has no public way to press an alert's button, and the app has no XCTest.
  let selector = NSSelectorFromString("_dismissAnimated:triggeringAction:triggeredByPopoverDimmingView:dismissCompletion:")
  guard let alert = top as? UIAlertController, let action = alert.actions.first(where: { $0.title == title }),
    alert.responds(to: selector) else { return false }
  typealias Dismiss = @convention(c) (AnyObject, Selector, Bool, UIAlertAction, Bool, AnyObject?) -> Void
  unsafeBitCast(alert.method(for: selector), to: Dismiss.self)(alert, selector, true, action, false, nil)
  return true
}

private enum Seams {
  static var closed = 0
}

private final class SampleWKWebView: WKWebView {}

private let authHosts: Set<String> = ["localhost"]

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
    guard authHosts.contains(space.host), space.receivesCredentialSecurely || space.host == "localhost" else {
      return completionHandler(.cancelAuthenticationChallenge, nil)
    }
    completionHandler(.useCredential, URLCredential(user: "u", password: "p", persistence: .forSession))
  }
}

private final class HookNavigation: NSObject, WKNavigationDelegate {
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(.allow)
  }
}

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
