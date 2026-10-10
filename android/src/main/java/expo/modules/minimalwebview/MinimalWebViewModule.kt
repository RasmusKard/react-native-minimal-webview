package expo.modules.minimalwebview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebChromeClient.FileChooserParams
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.Enumerable
import expo.modules.minimalwebview.extensions.PullToRefresh
import java.io.Serializable

class MinimalWebViewModule : Module() {
  private var fileChooser: AppContextActivityResultLauncher<ChooserIntent, Array<Uri>?>? = null
  private var chooserOpen = false

  /**
   * The system file chooser (ChromeClient.onShowFileChooser), one at a time app-wide: the launcher keeps one callback,
   * so a request while one is open gets null at once, as does one before the launcher is registered or without an
   * activity. Otherwise [onResult] gets the picked URIs, or null on cancel.
   */
  internal fun openFileChooser(intent: Intent, onResult: (Array<Uri>?) -> Unit) {
    val launcher = fileChooser
    if (launcher == null || chooserOpen) return onResult(null)
    chooserOpen = true
    try {
      launcher.launch(ChooserIntent(intent)) {
        chooserOpen = false
        onResult(it)
      }
    } catch (e: RuntimeException) { // no activity opens it, no current activity, or the launcher was unregistered
      chooserOpen = false
      Log.w(TAG, "the file chooser can't open", e)
      onResult(null)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    OnCreate {
      WebViewExtensions.register("pullToRefresh") { PullToRefresh() }
      // Built in on Android: CookieManager is shared app-wide.
      WebViewExtensions.register("sharedCookies") { object : WebViewExtension {} }
    }

    // The fallback runs when the result reaches a recreated activity: the WebView that asked is gone.
    // ponytail: if no result ever arrives (the activity died without one), choosers stay cancelled until relaunch.
    RegisterActivityContracts {
      fileChooser = registerForActivityResult(FileChooserContract) { _, _ -> chooserOpen = false }
    }

    // Cookies live in memory until flushed; persist them before the process can be killed.
    OnActivityEntersBackground {
      CookieManager.getInstance().flush()
    }

    // The WebView provider and the features this package uses (false: update Android System WebView).
    // Computed on first access and fixed after: a WebView update restarts the process.
    Constant("androidWebViewInfo") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val provider = WebViewCompat.getCurrentWebViewPackage(context)
      mapOf(
        "version" to (provider?.versionName ?: ""),
        "provider" to (provider?.packageName ?: ""),
        "available" to (provider != null),
        "features" to listOf(
          WebViewFeature.NAVIGATION_LISTENER,
          WebViewFeature.WEB_MESSAGE_LISTENER,
          WebViewFeature.DOCUMENT_START_SCRIPT,
          WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD
        ).associateWith { WebViewFeature.isFeatureSupported(it) }
      )
    }

    View(MinimalWebView::class) {
      Events("onNavigationState", "onBridge", "onExtension", "onError", "onProcessGone", "onNavigation")

      Prop("source") { view: MinimalWebView, source: WebViewSource? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("extensions") { view: MinimalWebView, extensions: List<ExtensionSpec>? -> view.extensions = extensions }
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
      Prop("injectedScripts") { view: MinimalWebView, value: List<InjectedScript>? -> view.injectedScripts = value }
      Prop("requestHandlers") { view: MinimalWebView, value: List<String>? -> view.requestHandlers = value.orEmpty().toSet() }
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
      AsyncFunction("getUrl") { view: MinimalWebView -> view.url }.runOnQueue(Queues.MAIN)
      // Resolves with the JSON-encoded result of the expression; JS parses it.
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.evaluate(script) { result ->
          result.fold(promise::resolve) { error -> promise.reject((error as EvaluateError).code, error.message, null) }
        }
      }.runOnQueue(Queues.MAIN)
    }
  }
}

/** The chooser's intent. Serializable because the registry persists launch inputs; it never relaunches a restored one. */
private class ChooserIntent(@Transient val intent: Intent? = null) : Serializable

private object FileChooserContract : AppContextActivityResultContract<ChooserIntent, Array<Uri>?> {
  override fun createIntent(context: Context, input: ChooserIntent) = checkNotNull(input.intent)

  override fun parseResult(input: ChooserIntent, resultCode: Int, intent: Intent?): Array<Uri>? =
    FileChooserParams.parseResult(resultCode, intent)
}

// Data classes, so the skip checks in applyProps compare them with ==. Every field is optional, as on iOS.

/** `{ uri, headers? }` or `{ html, baseUrl? }`. */
data class WebViewSource(
  @Field val uri: String? = null,
  @Field val headers: Map<String, String>? = null,
  @Field val html: String? = null,
  @Field val baseUrl: String? = null
) : Record

data class InjectedScript(
  @Field val code: String? = null,
  @Field("when") val time: InjectionTime? = null,
  @Field val mainFrameOnly: Boolean? = null
) : Record

enum class InjectionTime(val value: String) : Enumerable {
  START("start"),
  END("end")
}

data class ExtensionSpec(
  @Field val name: String? = null,
  @Field val config: Map<String, Any?>? = null,
  @Field val handles: List<String>? = null
) : Record
