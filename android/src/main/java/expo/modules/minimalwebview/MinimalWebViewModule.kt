package expo.modules.minimalwebview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebSettings
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
import org.json.JSONArray
import org.json.JSONObject
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

    // The fallback runs when the result reaches a recreated activity: the WebView that asked is gone.
    // ponytail: if no result ever arrives (the activity died without one), choosers stay cancelled until relaunch.
    RegisterActivityContracts {
      fileChooser = registerForActivityResult(FileChooserContract) { _, _ -> chooserOpen = false }
    }

    // Cookies live in memory until flushed; persist them before the process can be killed.
    OnActivityEntersBackground {
      CookieManager.getInstance().flush()
    }

    // The platform's default user agent (`WebView.defaultUserAgent` in JS), for apps that append to it.
    Constant("defaultUserAgent") {
      WebSettings.getDefaultUserAgent(appContext.reactContext ?: throw Exceptions.ReactContextLost())
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
          WebViewFeature.DOCUMENT_START_SCRIPT
        ).associateWith { WebViewFeature.isFeatureSupported(it) }
      )
    }

    View(MinimalWebView::class) {
      Events("onNavigationState", "onBridge", "onNativeEvent", "onError", "onProcessGone", "onNavigation")

      Prop("source") { view: MinimalWebView, source: WebViewSource? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("nativeOptions") { view: MinimalWebView, options: Map<String, Any?>? -> view.options = options.orEmpty() }
      // JSON, so a null (reset this key) survives: the map conversion drops nulls on iOS, and this keeps both the same.
      Prop("settings") { view: MinimalWebView, json: String? -> view.settings = json?.let { parseSettings(it) } }
      Prop("pullToRefresh") { view: MinimalWebView, value: Boolean? -> view.pullToRefresh = value ?: false }
      Prop("injectedScripts") { view: MinimalWebView, value: List<InjectedScript>? -> view.injectedScripts = value }
      Prop("requestHandlers") { view: MinimalWebView, value: List<String>? -> view.requestHandlers = value.orEmpty().toSet() }

      OnViewDidUpdateProps { view: MinimalWebView -> view.applyProps() }
      OnViewDestroys { view: MinimalWebView -> view.destroy() }

      AsyncFunction("navigate") { view: MinimalWebView, action: String ->
        when (action) {
          "back" -> view.webView.goBack()
          "forward" -> view.webView.goForward()
          "reload" -> view.reload()
          "stop" -> view.webView.stopLoading()
        }
      }.runOnQueue(Queues.MAIN)
      // `{ get: 'settings.textZoom' }` or `{ call: 'webView.clearCache', args: '[true]' }`: the JSON of the result. `args` is
      // a JSON string so a null argument survives the conversion.
      AsyncFunction("native") { view: MinimalWebView, request: Map<String, Any?>, promise: Promise ->
        val get = request["get"] as? String
        val call = request["call"] as? String
        try {
          promise.resolve(
            when {
              get != null -> view.platformSettings.get(get)
              call != null -> view.platformSettings.call(call, (request["args"] as? String)?.let { fromJson(JSONArray(it)) as List<Any?> } ?: emptyList())
              else -> throw IllegalArgumentException("a request needs `get` or `call`")
            }
          )
        } catch (e: IllegalArgumentException) {
          promise.reject("ERR_NATIVE", e.message, e)
        }
      }.runOnQueue(Queues.MAIN)
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

/** The `settings` prop's JSON (always an object: JS builds it) as nested maps and lists, with JSON null as null. */
private fun parseSettings(json: String): Map<String, Any?> = JSONObject(json).toMap()

private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { fromJson(get(it)) }

private fun fromJson(value: Any?): Any? = when (value) {
  JSONObject.NULL -> null
  is JSONObject -> value.toMap()
  is JSONArray -> List(value.length()) { fromJson(value.get(it)) }
  else -> value
}

/** The chooser's intent. Serializable because the registry persists launch inputs; it never relaunches a restored one. */
private class ChooserIntent(@Transient val intent: Intent? = null) : Serializable

private object FileChooserContract : AppContextActivityResultContract<ChooserIntent, Array<Uri>?> {
  override fun createIntent(context: Context, input: ChooserIntent) = checkNotNull(input.intent)

  override fun parseResult(input: ChooserIntent, resultCode: Int, intent: Intent?): Array<Uri>? =
    FileChooserParams.parseResult(resultCode, intent)
}

// Data classes, so the skip checks in applyProps compare them with ==. Every field is optional, as on iOS.

/** `{ uri, headers?, body? }` or `{ html, baseUrl? }`. `body` makes the request a form-urlencoded POST. */
data class WebViewSource(
  @Field val uri: String? = null,
  @Field val headers: Map<String, String>? = null,
  @Field val body: String? = null,
  @Field val html: String? = null,
  @Field val baseUrl: String? = null
) : Record

data class InjectedScript(
  @Field val code: String? = null,
  @Field val mainFrameOnly: Boolean? = null
) : Record

