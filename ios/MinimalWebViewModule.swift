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
      // JSON, so a null (reset this key) survives: the dictionary conversion drops nulls.
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

      AsyncFunction("navigate") { (view: MinimalWebView, action: String) in
        switch action {
        case "back": view.webView?.goBack()
        case "forward": view.webView?.goForward()
        case "reload": view.retry()
        case "stop": view.webView?.stopLoading()
        default: break
        }
      }
      // `get('scrollView.bounces')` reads a property; `call('webView.selector:', argsJson, completion)` calls a method
      // (docs/platform-settings.md). Both resolve with the JSON of the result. `argsJson` is a JSON string so a null
      // argument survives the conversion.
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
      // JS's answer to an `ask` (a page request, a navigation request or a hook's).
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, answer: [String: Any]) in
        view.pendingAsks.removeValue(forKey: askId)?(answer["value"] is NSNull ? nil : answer["value"])
      }
      // A hook's `context.handle` handler: the arguments and the reply cross as JSON, like `call`'s.
      AsyncFunction("hook") { (view: MinimalWebView, name: String, method: String, args: String, promise: Promise) in
        guard let handler = view.hookHandler(name, method) else {
          return promise.reject("hook_not_handled", "no attached hook `\(name)` handles `\(method)`")
        }
        handler((try? JSONSerialization.jsonObject(with: Data(args.utf8))) as? [Any] ?? []) { value in
          do {
            promise.resolve(try PlatformSettings.json { MRWJsonable(value) })
          } catch {
            promise.reject("native_error", (error as? PlatformError)?.message ?? error.localizedDescription)
          }
        }
      }
      // Resolves with the JSON-encoded value of the expression, awaiting a returned Promise; JS parses it.
      // The page encodes it, as on Android: what JSON can't encode (a function, a cycle) gives "null".
      // Rejects with unavailable when there is no WKWebView yet.
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        view.evaluate(script) { result in
          switch result {
          case .success(let json): promise.resolve(json)
          case .failure(let error): promise.reject(error.code, error.message)
          }
        }
      }
    }
  }
}

/// Runs `body` with the view's WKWebView; what it throws, or no WKWebView, rejects with `native_error`.
private func native(_ view: MinimalWebView, _ promise: Promise, _ body: (WKWebView) throws -> Void) {
  guard let webView = view.webView else { return promise.reject("native_error", "No WebView") }
  do {
    try body(webView)
  } catch {
    promise.reject("native_error", (error as? PlatformError)?.message ?? error.localizedDescription)
  }
}

// A prop that fails to convert is dropped whole (ExpoFabricView's try?), so every field is optional.

/// `{ uri, headers?, body? }` or `{ html, baseUrl? }`. `body` makes the request a form-urlencoded POST.
struct WebViewSource: Record {
  @Field var uri: String? = nil
  @Field var headers: [String: String]? = nil
  @Field var body: String? = nil
  @Field var html: String? = nil
  @Field var baseUrl: String? = nil
}

struct InjectedScript: Record {
  @Field var code: String? = nil
  @Field var mainFrameOnly: Bool? = nil
}

