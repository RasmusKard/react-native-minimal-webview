package expo.modules.minimalwebview

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.extensions.FileUpload
import expo.modules.minimalwebview.extensions.PullToRefresh

class MinimalWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    OnCreate {
      WebViewExtensions.register("pullToRefresh") { PullToRefresh() }
      WebViewExtensions.register("fileUpload") { FileUpload() }
    }

    View(MinimalWebView::class) {
      Events("onNavigationState", "onNavigationRequest", "onBridge", "onExtension")

      Prop("source") { view: MinimalWebView, source: Map<String, Any?>? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("extensions") { view: MinimalWebView, extensions: List<Map<String, Any?>>? -> view.extensions = extensions }

      OnViewDidUpdateProps { view: MinimalWebView -> view.applyProps() }
      OnViewDestroys { view: MinimalWebView -> view.destroy() }

      AsyncFunction("goBack") { view: MinimalWebView -> view.webView.goBack() }.runOnQueue(Queues.MAIN)
      AsyncFunction("goForward") { view: MinimalWebView -> view.webView.goForward() }.runOnQueue(Queues.MAIN)
      AsyncFunction("reload") { view: MinimalWebView -> view.webView.reload() }.runOnQueue(Queues.MAIN)
      AsyncFunction("stopLoading") { view: MinimalWebView -> view.webView.stopLoading() }.runOnQueue(Queues.MAIN)
      AsyncFunction("resolveNavigationRequest") { view: MinimalWebView, id: Int, action: String ->
        view.resolveNavigationRequest(id, action)
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("bridgePost") { view: MinimalWebView, message: String -> view.bridgePost(message) }.runOnQueue(Queues.MAIN)
      AsyncFunction("extensionCall") { view: MinimalWebView, name: String, method: String, args: Map<String, Any?> ->
        view.extensionCall(name, method, args)
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("getUrl") { view: MinimalWebView -> view.webView.url }.runOnQueue(Queues.MAIN)
      // Resolves with the JSON-encoded result of the expression; JS parses it.
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.webView.evaluateJavascript(script) { promise.resolve(it) }
      }.runOnQueue(Queues.MAIN)
    }
  }
}
