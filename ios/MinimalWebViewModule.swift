import ExpoModulesCore
import WebKit

public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    OnCreate {
      WebViewExtensions.register("pullToRefresh") { PullToRefresh() }
      WebViewExtensions.register("sharedCookies") { SharedCookies() }
    }

    // View functions run on the main queue.
    View(MinimalWebView.self) {
      Events("onNavigationState", "onBridge", "onExtension", "onError", "onProcessGone", "onNavigation")

      Prop("source") { (view: MinimalWebView, source: WebViewSource?) in view.source = source }
      Prop("bridgeScript") { (view: MinimalWebView, script: String?) in view.bridgeScript = script }
      Prop("bridgeOrigins") { (view: MinimalWebView, origins: [String]?) in view.bridgeOrigins = origins ?? [] }
      Prop("extensions") { (view: MinimalWebView, extensions: [ExtensionSpec]?) in view.extensions = extensions ?? [] }
      Prop("userAgent") { (view: MinimalWebView, value: String?) in view.userAgent = value }
      Prop("applicationNameForUserAgent") { (view: MinimalWebView, value: String?) in view.applicationNameForUserAgent = value }
      Prop("mediaPlaybackRequiresUserAction") { (view: MinimalWebView, value: Bool?) in view.mediaPlaybackRequiresUserAction = value ?? true }
      Prop("allowsInlineMediaPlayback") { (view: MinimalWebView, value: Bool?) in view.allowsInlineMediaPlayback = value ?? false }
      Prop("scrollEnabled") { (view: MinimalWebView, value: Bool?) in view.scrollEnabled = value ?? true }
      Prop("bounces") { (view: MinimalWebView, value: Bool?) in view.bounces = value ?? true }
      Prop("showsScrollIndicators") { (view: MinimalWebView, value: Bool?) in view.showsScrollIndicators = value ?? true }
      Prop("javaScriptCanOpenWindowsAutomatically") { (view: MinimalWebView, value: Bool?) in
        view.javaScriptCanOpenWindowsAutomatically = value ?? false
      }
      Prop("navigationRules") { (view: MinimalWebView, rules: [[String: Any]]?) in view.navigationRules = rules }
      Prop("injectedScripts") { (view: MinimalWebView, value: [InjectedScript]?) in view.injectedScripts = value ?? [] }
      Prop("requestHandlers") { (view: MinimalWebView, value: [String]?) in view.requestHandlers = Set(value ?? []) }
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
      AsyncFunction("getUrl") { (view: MinimalWebView) in view.url }
      // Resolves with the JSON-encoded value of the expression, awaiting a returned Promise; JS parses it.
      // The page encodes it, as on Android: what JSON can't encode (a function, a cycle) gives "null".
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        guard view.webView != nil else { return promise.resolve(nil) }
        view.evaluate(script) { result in
          switch result {
          case .success(let json): promise.resolve(json)
          case .failure(let error as EvaluateError): promise.reject(error.code, error.message)
          case .failure(let error): promise.reject("ERR_EVALUATE", error.localizedDescription)
          }
        }
      }
    }
  }
}

// A prop that fails to convert is dropped whole (ExpoFabricView's try?), so every field is optional.

/// `{ uri, headers? }` or `{ html, baseUrl? }`.
struct WebViewSource: Record {
  @Field var uri: String? = nil
  @Field var headers: [String: String]? = nil
  @Field var html: String? = nil
  @Field var baseUrl: String? = nil
}

struct InjectedScript: Record {
  @Field var code: String? = nil
  @Field var when: InjectionTime? = nil
  @Field var mainFrameOnly: Bool? = nil
}

enum InjectionTime: String, Enumerable {
  case start
  case end
}

struct ExtensionSpec: Record {
  @Field var name: String? = nil
  @Field var config: [String: Any]? = nil
  @Field var handles: [String]? = nil
}
