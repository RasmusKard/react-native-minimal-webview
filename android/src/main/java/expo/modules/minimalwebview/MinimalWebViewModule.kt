package expo.modules.minimalwebview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.Profile
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewOutcomeReceiver
import androidx.webkit.WebViewStartUpConfig
import androidx.webkit.WebViewStartUpResult
import androidx.webkit.WebViewStartupException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.exception.toCodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONArray
import org.json.JSONObject
import java.io.Serializable

/**
 * Public only for Expo's autolinking.
 * @suppress
 */
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
    // shortcut: choosers stay cancelled after an activity dies without a result, track the request if apps hit it
    RegisterActivityContracts {
      fileChooser = registerForActivityResult(FileChooserContract) { _, _ -> chooserOpen = false }
    }

    // Cookies live in memory until flushed; persist them before the process can be killed. Only once a WebView was
    // made: CookieManager.getInstance() would otherwise start WebView, on the UI thread, in an app that never shows one.
    OnActivityEntersBackground {
      if (webViewCreated) CookieManager.getInstance().flush()
      MinimalWebView.inBackground = true
    }

    // A WebView whose renderer died in the background is rebuilt now.
    OnActivityEntersForeground {
      MinimalWebView.inBackground = false
    }

    // Best effort: an error only means the first WebView starts WebView as before.
    Function("warmUp") { warmUp(appContext.reactContext ?: throw Exceptions.ReactContextLost()) }

    // ProfileStore wants the UI thread, and starts WebView there.
    AsyncFunction("preconnect") { url: String -> preconnect(url) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setWebContentsDebuggingEnabled") { enabled: Boolean -> setWebContentsDebugging(enabled) }.runOnQueue(Queues.MAIN)

    Constant("defaultUserAgent") {
      WebSettings.getDefaultUserAgent(appContext.reactContext ?: throw Exceptions.ReactContextLost())
    }

    View(MinimalWebView::class) {
      Events("onNavigationState", "onBridge", "onHookEvent", "onError", "onProcessGone", "onNavigation")

      Prop("source") { view: MinimalWebView, source: WebViewSource? -> view.source = source }
      Prop("navigationRules") { view: MinimalWebView, rules: List<Map<String, Any?>>? -> view.navigationRules = rules }
      Prop("bridgeScript") { view: MinimalWebView, script: String? -> view.bridgeScript = script }
      Prop("bridgeOrigins") { view: MinimalWebView, origins: List<String>? -> view.bridgeOrigins = origins }
      Prop("hookOptions") { view: MinimalWebView, options: Map<String, Any?>? -> view.hookOptions = options.orEmpty() }
      // The JSON is always an object (JS builds it).
      Prop("settings") { view: MinimalWebView, json: String? -> view.settings = json?.let { JSONObject(it).toMap() } }
      Prop("pullToRefresh") { view: MinimalWebView, value: Boolean? -> view.pullToRefresh = value ?: false }
      Prop("injectedScripts") { view: MinimalWebView, value: List<InjectedScript>? -> view.injectedScripts = value }
      Prop("requestHandlers") { view: MinimalWebView, value: List<String>? -> view.requestHandlers = value.orEmpty().toSet() }

      OnViewDidUpdateProps { view: MinimalWebView -> view.applyProps() }
      OnViewDestroys { view: MinimalWebView -> view.destroy() }

      AsyncFunction("navigate") { view: MinimalWebView, action: String -> navigate(view, action) }.runOnQueue(Queues.MAIN)
      AsyncFunction("get") { view: MinimalWebView, path: String, promise: Promise ->
        native(view, promise) { promise.resolve(view.platformSettings.get(path)) }
      }.runOnQueue(Queues.MAIN)
      // The third argument is iOS's completion name, which Android has no use for.
      AsyncFunction("call") { view: MinimalWebView, path: String, argsJson: String, _: String?, promise: Promise ->
        native(view, promise) {
          view.platformSettings.call(path, fromJson(JSONArray(argsJson)) as List<Any?>) { json -> native(view, promise) { promise.resolve(json()) } }
        }
        // A call can change what the state shows (clearHistory, canGoBack); an unchanged state isn't sent.
        view.stateChanged()
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("bridgePost") { view: MinimalWebView, message: String -> view.bridgePost(message) }.runOnQueue(Queues.MAIN)
      AsyncFunction("answer") { view: MinimalWebView, askId: Int, answer: Map<String, Any?> ->
        view.asks.answer(askId, answer["value"])
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("hook") { view: MinimalWebView, name: String, method: String, args: String, promise: Promise ->
        hook(view, name, method, args, promise)
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("evaluate") { view: MinimalWebView, script: String, promise: Promise ->
        view.evaluate(script) { result ->
          result.fold(promise::resolve) { promise.reject(it.toCodedException()) }
        }
      }.runOnQueue(Queues.MAIN)
    }
  }
}

private fun preconnect(url: String) {
  if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return
  val profile = ProfileStore.getInstance().getOrCreateProfile(Profile.DEFAULT_PROFILE_NAME)
  when {
    WebViewFeature.isFeatureSupported(WebViewFeature.ENQUEUE_PRECONNECT) -> profile.enqueuePreconnect(url)
    WebViewFeature.isFeatureSupported(WebViewFeature.PRECONNECT) -> profile.preconnect(url)
  }
}

/** Before the first WebView only stored, for each new WebView to apply: setting it now would start WebView. */
private fun setWebContentsDebugging(enabled: Boolean) {
  webContentsDebugging = enabled
  if (webViewCreated) WebView.setWebContentsDebuggingEnabled(enabled)
}

private fun warmUp(context: Context) {
  val config = WebViewStartUpConfig.Builder { Thread(it, "WebViewWarmUp").start() }.build()
  WebViewCompat.startUpWebView(context, config, object : WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException> {
    override fun onResult(result: WebViewStartUpResult) = Unit

    override fun onError(error: WebViewStartupException) {
      Log.w(TAG, "WebView warm-up failed", error)
    }
  })
}

private fun navigate(view: MinimalWebView, action: String) {
  // While recovering, `webView` is the destroyed one: only reload acts, by building the new one.
  if (view.recovering && action != "reload") return
  when (action) {
    "back" -> view.webView.goBack()
    "forward" -> view.webView.goForward()
    "reload" -> view.retry()
    "stop" -> view.webView.stopLoading()
  }
}

private fun hook(view: MinimalWebView, name: String, method: String, args: String, promise: Promise) {
  if (view.recovering) return promise.reject("unavailable", RECOVERING, null)
  val handler = view.hookHandler(name, method)
    ?: return promise.reject("not_found", "no attached hook `$name` handles `$method`", null)
  try {
    handler(fromJson(JSONArray(args)) as List<Any?>) { native(view, promise) { promise.resolve(PlatformSettings.toJson(it)) } }
  } catch (e: Exception) {
    promise.reject("native_error", e.message, e)
  }
}

/**
 * Runs [body], which resolves [promise]. A [PlatformException] it throws rejects with its code, anything else with
 * `native_error`, and a dead WebView with `unavailable`.
 */
private inline fun native(view: MinimalWebView, promise: Promise, body: () -> Unit) =
  if (view.recovering) {
    promise.reject("unavailable", RECOVERING, null)
  } else {
    try {
      body()
    } catch (e: Exception) {
      promise.reject((e as? PlatformException)?.code ?: "native_error", e.message, e)
    }
  }

/** Nested maps and lists, with JSON null as null. */
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

internal data class WebViewSource(
  @Field val uri: String? = null,
  @Field val headers: Map<String, String>? = null,
  @Field val body: String? = null,
  // Unused on Android: here so that a change loads the source again, as on iOS.
  @Field val readAccessRoot: String? = null,
  @Field val html: String? = null,
  @Field val baseUrl: String? = null
) : Record

internal data class InjectedScript(
  @Field val code: String? = null,
  @Field val allFrames: Boolean? = null
) : Record

