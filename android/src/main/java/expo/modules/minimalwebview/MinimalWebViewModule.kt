package expo.modules.minimalwebview

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MinimalWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    View(MinimalWebView::class) {
      Events("onNavigationState", "onNavigationRequest", "onBridge")

      Prop("source") { view: MinimalWebView, source: Map<String, Any?>? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }

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
      AsyncFunction("getUrl") { view: MinimalWebView -> view.webView.url }.runOnQueue(Queues.MAIN)
      // Resolves with the JSON-encoded result of the expression; JS parses it.
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.webView.evaluateJavascript(script) { promise.resolve(it) }
      }.runOnQueue(Queues.MAIN)
    }
  }
}
