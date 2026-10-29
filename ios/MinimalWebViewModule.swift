import ExpoModulesCore
import WebKit

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

      AsyncFunction("navigate") { (view: MinimalWebView, action: String) in navigate(view, action) }
      AsyncFunction("get") { (view: MinimalWebView, path: String, promise: Promise) in
        native(view, promise) { webView in promise.resolve(try view.platformSettings.get(path, webView: webView)) }
      }
      AsyncFunction("call") { (view: MinimalWebView, path: String, argsJson: String, completion: String?, promise: Promise) in
        let args = (try? JSONSerialization.jsonObject(with: Data(argsJson.utf8))) as? [Any] ?? []
        native(view, promise) { webView in
          try view.platformSettings.call(path, args: args, completion: completion, webView: webView) { json, error in
            if let error { promise.reject("native_error", error) } else { promise.resolve(json) }
          }
        }
      }
      AsyncFunction("bridgePost") { (view: MinimalWebView, message: String) in view.bridgePost(message) }
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, answer: [String: Any]) in
        view.asks.answer(askId, answer["value"] is NSNull ? nil : answer["value"])
      }
      AsyncFunction("hook") { (view: MinimalWebView, name: String, method: String, args: String, promise: Promise) in
        hook(view, name, method, args, promise)
      }
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        evaluate(view, script, promise)
      }
    }
  }
}

private func navigate(_ view: MinimalWebView, _ action: String) {
  switch action {
  case "back": view.webView?.goBack()
  case "forward": view.webView?.goForward()
  case "reload": view.retry()
  case "stop": view.webView?.stopLoading()
  default: break
  }
}

private func evaluate(_ view: MinimalWebView, _ script: String, _ promise: Promise) {
  view.evaluate(script) { result in
    switch result {
    case .success(let json): promise.resolve(json)
    case .failure(let error): promise.reject(error.code, error.message)
    }
  }
}

private func hook(_ view: MinimalWebView, _ name: String, _ method: String, _ args: String, _ promise: Promise) {
  guard let handler = view.hookHandler(name, method) else {
    return promise.reject("not_found", "no attached hook `\(name)` handles `\(method)`")
  }
  handler((try? JSONSerialization.jsonObject(with: Data(args.utf8))) as? [Any] ?? []) { value in
    do {
      promise.resolve(try PlatformSettings.json { MRWJsonable(value) })
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
  @Field var html: String? = nil
  @Field var baseUrl: String? = nil
}

struct InjectedScript: Record {
  @Field var code: String? = nil
  @Field var allFrames: Bool? = nil
}

