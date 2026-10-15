import ExpoModulesCore
import WebKit

public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    // View functions run on the main queue.
    View(MinimalWebView.self) {
      Events("onNavigationState", "onBridge", "onNativeEvent", "onError", "onProcessGone", "onNavigation")

      Prop("source") { (view: MinimalWebView, source: WebViewSource?) in view.source = source }
      Prop("bridgeScript") { (view: MinimalWebView, script: String?) in view.bridgeScript = script }
      Prop("bridgeOrigins") { (view: MinimalWebView, origins: [String]?) in view.bridgeOrigins = origins ?? [] }
      Prop("nativeOptions") { (view: MinimalWebView, options: [String: Any]?) in view.options = options ?? [:] }
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
        case "reload": view.reload()
        case "stop": view.webView?.stopLoading()
        default: break
        }
      }
      // `{ get: 'scrollView.bounces' }` reads a property; `{ call: 'webView.selector:', args, completion }` calls a
      // method (README: Platform settings). Both resolve with the JSON of the result. `args` is a JSON string so a null
      // argument survives the conversion.
      AsyncFunction("native") { (view: MinimalWebView, request: [String: Any], promise: Promise) in
        guard let webView = view.webView else { return promise.reject("ERR_NATIVE", "No WebView") }
        do {
          if let get = request["get"] as? String {
            promise.resolve(try view.platformSettings.get(get, webView: webView))
          } else if let call = request["call"] as? String {
            let data = (request["args"] as? String)?.data(using: .utf8) ?? Data()
            let args = (try? JSONSerialization.jsonObject(with: data)) as? [Any] ?? []
            try view.platformSettings.call(call, args: args, completion: request["completion"] as? String, webView: webView) { json, error in
              if let error { promise.reject("ERR_NATIVE", error) } else { promise.resolve(json) }
            }
          } else {
            throw PlatformError("a request needs `get` or `call`")
          }
        } catch let error as PlatformError {
          promise.reject("ERR_NATIVE", error.message)
        } catch {
          promise.reject("ERR_NATIVE", error.localizedDescription)
        }
      }
      AsyncFunction("bridgePost") { (view: MinimalWebView, message: String) in view.bridgePost(message) }
      // JS's answer to an `ask` (a page request, a navigation request or a hook's).
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, answer: [String: Any]) in
        view.pendingAsks.removeValue(forKey: askId)?(answer["value"] is NSNull ? nil : answer["value"])
      }
      // Resolves with the JSON-encoded value of the expression, awaiting a returned Promise; JS parses it.
      // The page encodes it, as on Android: what JSON can't encode (a function, a cycle) gives "null".
      // Rejects with ERR_EVALUATE when there is no WKWebView yet, like the extension host's evaluate.
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
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

