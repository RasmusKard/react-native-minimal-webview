import ExpoModulesCore
import WebKit

public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    OnCreate {
      WebViewExtensions.register("pullToRefresh") { PullToRefresh() }
      WebViewExtensions.register("downloads") { Downloads() }
      WebViewExtensions.register("permissions") { Permissions() }
      WebViewExtensions.register("sharedCookies") { SharedCookies() }
      WebViewExtensions.register("httpAuth") { HttpAuth() }
      // Built in on iOS: WebKit's own fullscreen video and file picker.
      WebViewExtensions.register("fullscreenVideo") { BuiltIn() }
      WebViewExtensions.register("fileUpload") { BuiltIn() }
    }

    // View functions run on the main queue.
    View(MinimalWebView.self) {
      Events("onNavigationState", "onBridge", "onExtension", "onError", "onProcessGone", "onNavigation", "onNavigationRequest")

      Prop("source") { (view: MinimalWebView, source: [String: Any]?) in view.source = source }
      Prop("bridgeScript") { (view: MinimalWebView, script: String?) in view.bridgeScript = script }
      Prop("bridgeOrigins") { (view: MinimalWebView, origins: [String]?) in view.bridgeOrigins = origins ?? [] }
      Prop("extensions") { (view: MinimalWebView, extensions: [[String: Any]]?) in view.extensions = extensions ?? [] }
      Prop("userAgent") { (view: MinimalWebView, value: String?) in view.userAgent = value }
      Prop("applicationNameForUserAgent") { (view: MinimalWebView, value: String?) in view.applicationNameForUserAgent = value }
      Prop("mediaPlaybackRequiresUserAction") { (view: MinimalWebView, value: Bool?) in view.mediaPlaybackRequiresUserAction = value ?? true }
      Prop("allowsInlineMediaPlayback") { (view: MinimalWebView, value: Bool?) in view.allowsInlineMediaPlayback = value ?? false }
      Prop("scrollEnabled") { (view: MinimalWebView, value: Bool?) in view.scrollEnabled = value ?? true }
      Prop("bounces") { (view: MinimalWebView, value: Bool?) in view.bounces = value ?? true }
      Prop("showsScrollIndicators") { (view: MinimalWebView, value: Bool?) in view.showsScrollIndicators = value ?? true }
      Prop("navigationRules") { (view: MinimalWebView, rules: [[String: Any]]?) in view.navigationRules = rules }
      Prop("injectedScripts") { (view: MinimalWebView, value: [[String: Any]]?) in view.injectedScripts = value ?? [] }
      Prop("openExternalInJS") { (view: MinimalWebView, value: Bool?) in view.openExternalInJS = value ?? false }
      Prop("webviewDebuggingEnabled") { (view: MinimalWebView, value: Bool?) in view.webviewDebuggingEnabled = value ?? false }

      OnViewDidUpdateProps { (view: MinimalWebView) in view.applyProps() }

      AsyncFunction("goBack") { (view: MinimalWebView) in view.webView?.goBack() }
      AsyncFunction("goForward") { (view: MinimalWebView) in view.webView?.goForward() }
      AsyncFunction("reload") { (view: MinimalWebView) in view.reload() }
      AsyncFunction("stopLoading") { (view: MinimalWebView) in view.webView?.stopLoading() }
      AsyncFunction("bridgePost") { (view: MinimalWebView, message: String) in view.bridgePost(message) }
      // JS's answer to an `ask` (navigation or extension).
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, answer: [String: Any]) in
        view.pendingAsks.removeValue(forKey: askId)?(answer["value"] is NSNull ? nil : answer["value"])
      }
      AsyncFunction("getUrl") { (view: MinimalWebView) in view.failedUrl ?? view.webView?.url?.absoluteString }
      // Resolves with the JSON-encoded value of the expression, awaiting a returned Promise; JS parses it.
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        guard let webView = view.webView else { return promise.resolve(nil) }
        let body = "return ((v) => { try { return JSON.stringify(v) ?? 'null' } catch { return 'null' } })(await (\n\(script)\n))"
        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
      // The page encodes it, as on Android: what JSON can't encode (a function, a cycle) gives "null".
          switch result {
          case .success(let value):
            promise.resolve(value as? String ?? "null")
          case .failure(let error):
            promise.reject("ERR_EVALUATE", error.localizedDescription)
          }
        }
      }
    }
  }
}

/// Registered for helpers whose feature WebKit already provides, so they need no native code on iOS.
private final class BuiltIn: WebViewExtension {}
