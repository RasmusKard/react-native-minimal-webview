import ExpoModulesCore
import WebKit

/// The Expo module behind the `MinimalWebView` view; autolinking loads it, and apps don't call it.
@_documentation(visibility: internal)
public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    // View functions run on the main queue.
    View(MinimalWebView.self) {
      Events("onNavigationState", "onBridge", "onHookEvent", "onError", "onProcessGone", "onNavigation")

      Prop("source") { (view: MinimalWebView, source: WebViewSource?) in view.source = source }
      Prop("bridgeScript") { (view: MinimalWebView, script: String?) in view.bridgeScript = script }
      Prop("bridgeOrigins") { (view: MinimalWebView, origins: [String]?) in view.bridgeOrigins = origins ?? [] }
      Prop("hookOptions") { (view: MinimalWebView, options: [String: Any]?) in view.hookOptions = options ?? [:] }
      Prop("settings") { (view: MinimalWebView, json: String?) in
        let data = json?.data(using: .utf8) ?? Data()
        view.settings = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
      }
      Prop("pullToRefresh") { (view: MinimalWebView, value: Bool?) in view.pullToRefresh = value ?? false }
      Prop("sharedCookies") { (view: MinimalWebView, value: Bool?) in view.sharedCookies = value ?? false }
      Prop("navigationRules") { (view: MinimalWebView, rules: [[String: Any]]?) in view.navigationRules = rules }
      Prop("injectedScripts") { (view: MinimalWebView, value: [InjectedScript]?) in view.injectedScripts = value ?? [] }
      Prop("requestHandlers") { (view: MinimalWebView, value: [String]?) in view.requestHandlers = Set(value ?? []) }

      OnViewDidUpdateProps { (view: MinimalWebView) in view.applyProps() }

      AsyncFunction("goBack") { (view: MinimalWebView) in view.webView?.goBack() }
      AsyncFunction("goForward") { (view: MinimalWebView) in view.webView?.goForward() }
      AsyncFunction("reload") { (view: MinimalWebView) in view.retry() }
      AsyncFunction("stopLoading") { (view: MinimalWebView) in view.webView?.stopLoading() }
      AsyncFunction("get") { (view: MinimalWebView, path: String, promise: Promise) in
        native(view, promise) { webView in promise.resolve(try view.platformSettings.get(path, webView: webView)) }
      }
      AsyncFunction("call") { (view: MinimalWebView, path: String, argsJson: String, promise: Promise) in
        call(view, path, argsJson, promise)
      }
      AsyncFunction("bridgePost") { (view: MinimalWebView, message: String) in view.bridgePost(message) }
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, json: String) in
        let value = try? JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed)
        view.asks.answer(askId, value is NSNull ? nil : value)
      }
      AsyncFunction("hook") { (view: MinimalWebView, name: String, method: String, args: String, promise: Promise) in
        hook(view, name, method, args, promise)
      }
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        view.evaluate(script, promise)
      }
    }
  }
}

private func call(_ view: MinimalWebView, _ path: String, _ argsJson: String, _ promise: Promise) {
  let args = (try? JSONSerialization.jsonObject(with: Data(argsJson.utf8))) as? [Any] ?? []
  native(view, promise) { webView in
    try view.platformSettings.call(path, args: args, webView: webView) { json, error in
      if let error { promise.reject("native_error", error) } else { promise.resolve(json) }
    }
  }
}

private func hook(_ view: MinimalWebView, _ name: String, _ method: String, _ args: String, _ promise: Promise) {
  guard let handler = view.hookHandler(name, method) else {
    return promise.reject("not_found", "no attached hook `\(name)` handles `\(method)`")
  }
  handler((try? JSONSerialization.jsonObject(with: Data(args.utf8))) as? [Any] ?? []) { value in
    do {
      promise.resolve(try PlatformSettings.json { __MRWJsonable(value) })
    } catch {
      reject(promise, error)
    }
  }
}

private func native(_ view: MinimalWebView, _ promise: Promise, _ body: (WKWebView) throws -> Void) {
  guard let webView = view.webView else { return promise.reject("unavailable", "No WebView") }
  do {
    try body(webView)
  } catch {
    reject(promise, error)
  }
}

private func reject(_ promise: Promise, _ error: Error) {
  let platform = error as? PlatformError
  promise.reject(platform?.code ?? "native_error", platform?.message ?? error.localizedDescription)
}

// A prop that fails to convert is dropped whole (ExpoFabricView's try?), so every field is optional.

struct WebViewSource: Record {
  @Field var uri: String? = nil
  @Field var headers: [String: String]? = nil
  @Field var body: String? = nil
  @Field var readAccessRoot: String? = nil
  @Field var html: String? = nil
  @Field var baseUrl: String? = nil
}

struct InjectedScript: Record {
  @Field var code: String? = nil
  @Field var allFrames: Bool? = nil
}

