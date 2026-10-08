package expo.modules.minimalwebview

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MinimalWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    View(MinimalWebView::class) {
      Events("onNavigationState")

      Prop("source") { view: MinimalWebView, source: Map<String, Any?>? -> view.source = source }

      OnViewDidUpdateProps { view: MinimalWebView -> view.applyProps() }
      OnViewDestroys { view: MinimalWebView -> view.destroy() }

      AsyncFunction("goBack") { view: MinimalWebView -> view.webView.goBack() }.runOnQueue(Queues.MAIN)
      AsyncFunction("goForward") { view: MinimalWebView -> view.webView.goForward() }.runOnQueue(Queues.MAIN)
      AsyncFunction("reload") { view: MinimalWebView -> view.webView.reload() }.runOnQueue(Queues.MAIN)
      AsyncFunction("stopLoading") { view: MinimalWebView -> view.webView.stopLoading() }.runOnQueue(Queues.MAIN)
      AsyncFunction("getUrl") { view: MinimalWebView -> view.webView.url }.runOnQueue(Queues.MAIN)
      // Resolves with the JSON-encoded result of the expression; JS parses it.
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.webView.evaluateJavascript(script) { promise.resolve(it) }
      }.runOnQueue(Queues.MAIN)
    }
  }
}
