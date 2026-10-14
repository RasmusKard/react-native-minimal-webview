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
      // JSON, so a null (reset this key) survives: the dictionary conversion drops nulls.
      Prop("settings") { (view: MinimalWebView, json: String?) in
        let data = json?.data(using: .utf8) ?? Data()
        view.settings = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
      }
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
      // `{ get: 'scrollView.bounces' }`: the JSON of the property. Method calls are Android-only (a native hook on iOS).
      AsyncFunction("native") { (view: MinimalWebView, request: [String: Any], promise: Promise) in
        guard let get = request["get"] as? String else {
          return promise.reject("unavailable", "only `get` is supported on iOS; use a native hook to call methods")
        }
        guard let webView = view.webView else { return promise.reject("ERR_NATIVE", "No WebView") }
        do {
          promise.resolve(try view.platformSettings.get(get, webView: webView))
        } catch let error as PlatformError {
          promise.reject("ERR_NATIVE", error.message)
        } catch {
          promise.reject("ERR_NATIVE", error.localizedDescription)
        }
      }
      AsyncFunction("bridgePost") { (view: MinimalWebView, message: String) in view.bridgePost(message) }
      // JS's answer to an `ask` (navigation or extension).
      AsyncFunction("answer") { (view: MinimalWebView, askId: Int, answer: [String: Any]) in
        view.pendingAsks.removeValue(forKey: askId)?(answer["value"] is NSNull ? nil : answer["value"])
      }
      AsyncFunction("getUrl") { (view: MinimalWebView) in view.url }
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
