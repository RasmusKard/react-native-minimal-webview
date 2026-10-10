import ExpoModulesCore
import WebKit

public class MinimalWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebView")

    // View functions run on the main queue.
    View(MinimalWebView.self) {
      Events("onNavigationState")

      Prop("source") { (view: MinimalWebView, source: [String: Any]?) in view.source = source }

      OnViewDidUpdateProps { (view: MinimalWebView) in view.applyProps() }

      AsyncFunction("goBack") { (view: MinimalWebView) in view.webView?.goBack() }
      AsyncFunction("goForward") { (view: MinimalWebView) in view.webView?.goForward() }
      AsyncFunction("reload") { (view: MinimalWebView) in view.webView?.reload() }
      AsyncFunction("stopLoading") { (view: MinimalWebView) in view.webView?.stopLoading() }
      AsyncFunction("getUrl") { (view: MinimalWebView) in view.webView?.url?.absoluteString }
      // Resolves with the JSON-encoded value of the expression, awaiting a returned Promise; JS parses it.
      AsyncFunction("evaluate") { (view: MinimalWebView, script: String, promise: Promise) in
        guard let webView = view.webView else { return promise.resolve(nil) }
        webView.callAsyncJavaScript("return await (\n\(script)\n)", arguments: [:], in: nil, in: .page) { result in
          switch result {
          case .success(let value):
            let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
            promise.resolve(data.flatMap { String(data: $0, encoding: .utf8) })
          case .failure(let error):
            promise.reject("ERR_EVALUATE", error.localizedDescription)
          }
        }
      }
    }
  }
}
