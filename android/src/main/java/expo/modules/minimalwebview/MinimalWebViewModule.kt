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
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("extensions") { view: MinimalWebView, extensions: List<Map<String, Any?>>? -> view.extensions = extensions }
      Prop("userAgent") { view: MinimalWebView, value: String? -> view.userAgent = value }
      Prop("applicationNameForUserAgent") { view: MinimalWebView, value: String? -> view.applicationNameForUserAgent = value }
      Prop("thirdPartyCookiesEnabled") { view: MinimalWebView, value: Boolean? -> view.thirdPartyCookiesEnabled = value ?: false }
      Prop("mediaPlaybackRequiresUserAction") { view: MinimalWebView, value: Boolean? ->
        view.mediaPlaybackRequiresUserAction = value ?: true
      }
      Prop("showsScrollIndicators") { view: MinimalWebView, value: Boolean? -> view.showsScrollIndicators = value ?: true }
      Prop("javaScriptCanOpenWindowsAutomatically") { view: MinimalWebView, value: Boolean? ->
        view.javaScriptCanOpenWindowsAutomatically = value ?: false
      }
      Prop("injectedScripts") { view: MinimalWebView, value: List<Map<String, Any?>>? -> view.injectedScripts = value }
      Prop("openExternalInJS") { view: MinimalWebView, value: Boolean? -> view.openExternalInJS = value ?: false }
      Prop("webviewDebuggingEnabled") { view: MinimalWebView, value: Boolean? -> view.webviewDebuggingEnabled = value ?: false }

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
