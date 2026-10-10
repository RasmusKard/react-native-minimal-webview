package expo.modules.minimalwebview

import android.webkit.CookieManager
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.extensions.Downloads
import expo.modules.minimalwebview.extensions.FileUpload
import expo.modules.minimalwebview.extensions.FullscreenVideo
import expo.modules.minimalwebview.extensions.HttpAuth
import expo.modules.minimalwebview.extensions.Permissions
import expo.modules.minimalwebview.extensions.PullToRefresh

class MinimalWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    OnCreate {
      WebViewExtensions.register("pullToRefresh") { PullToRefresh() }
      WebViewExtensions.register("fileUpload") { FileUpload() }
      WebViewExtensions.register("fullscreenVideo") { FullscreenVideo() }
      WebViewExtensions.register("downloads") { Downloads() }
      WebViewExtensions.register("permissions") { Permissions() }
      WebViewExtensions.register("httpAuth") { HttpAuth() }
      // Built in on Android: CookieManager is shared app-wide.
      WebViewExtensions.register("sharedCookies") { object : WebViewExtension {} }
    }

    // Cookies live in memory until flushed; persist them before the process can be killed.
    OnActivityEntersBackground {
      CookieManager.getInstance().flush()
    }

    // The WebView provider and the features this package uses (false: update Android System WebView).
    Function("getAndroidWebViewInfo") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val provider = WebViewCompat.getCurrentWebViewPackage(context)
      mapOf(
        "version" to (provider?.versionName ?: ""),
        "provider" to (provider?.packageName ?: ""),
        "available" to (provider != null),
        "features" to listOf(
          WebViewFeature.NAVIGATION_LISTENER,
          WebViewFeature.WEB_MESSAGE_LISTENER,
          WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD
        ).associateWith { WebViewFeature.isFeatureSupported(it) }
      )
    }

    View(MinimalWebView::class) {
      Events("onNavigationState", "onNavigationRequest", "onBridge", "onExtension", "onError", "onProcessGone", "onNavigation")

      Prop("source") { view: MinimalWebView, source: Map<String, Any?>? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("extensions") { view: MinimalWebView, extensions: List<Map<String, Any?>>? -> view.extensions = extensions }
      Prop("userAgent") { view: MinimalWebView, value: String? -> view.userAgent = value }
      Prop("applicationNameForUserAgent") { view: MinimalWebView, value: String? -> view.applicationNameForUserAgent = value }
      Prop("thirdPartyCookies") { view: MinimalWebView, value: Boolean? -> view.thirdPartyCookies = value ?: false }
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
      AsyncFunction("bridgePost") { view: MinimalWebView, message: String -> view.bridgePost(message) }.runOnQueue(Queues.MAIN)
      AsyncFunction("answer") { view: MinimalWebView, askId: Int, answer: Map<String, Any?> ->
        view.answer(askId, answer["value"])
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("getUrl") { view: MinimalWebView -> view.webView.url }.runOnQueue(Queues.MAIN)
      // Resolves with the JSON-encoded result of the expression; JS parses it.
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.evaluate(script) { result ->
          result.fold(promise::resolve) { error -> promise.reject((error as EvaluateError).code, error.message, null) }
        }
      }.runOnQueue(Queues.MAIN)
    }
  }
}
