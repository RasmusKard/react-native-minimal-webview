package expo.modules.minimalwebview

import android.app.Activity
import android.content.Context
import android.webkit.SafeBrowsingResponse
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * Native hooks: how an app or a package reaches the WebView this package creates, with no protocol to implement.
 * A hook is registered under the `nativeOptions` key that enables it, from an Expo module's `OnCreate` (before the
 * first WebView is created), and runs for each WebView whose `nativeOptions` has that key, on the main thread.
 * README "Native hooks" has the rules for the clients and the events.
 */
object MinimalWebViewHooks {
  /** Makes each WebView: the first one, and a new one after the render process dies. A subclass can override what WebView lets it. */
  var webViewFactory: (Context) -> WebView = { WebView(it) }

  /**
   * Runs for each new WebView (the first, and the one that replaces it after the render process dies) once it has its
   * clients and is in the view hierarchy. Returns what to run when it goes away, or null.
   */
  val attach = mutableMapOf<String, (WebView, WebViewContext) -> (() -> Unit)?>()
}

/** One WebView instance, as a hook sees it. */
interface WebViewContext {
  /** The `nativeOptions` prop: whatever the app passed for its hooks. */
  val options: Map<String, Any?>
  val activity: Activity?

  /**
   * Clients for the WebView, in order; add them in `attach`. A callback goes to the core, to the first client that
   * overrides it, or to every one, by the rules in README "Native hooks".
   */
  val clients: MutableList<WebViewClient>
  val chromeClients: MutableList<WebChromeClient>

  /** Sends `onNativeEvent({ name: "<hook>.<name>", payload })` to JS. */
  fun emit(name: String, payload: Map<String, Any?>)

  /** Sends the event and waits for JS's answer, the handler's return value; null when the view or its page goes away. */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)
}

/** A hook's view of the WebView: the core's context with the hook's name on its events. */
internal class HookContext(private val name: String, private val view: WebViewContext) : WebViewContext by view {
  override fun emit(name: String, payload: Map<String, Any?>) = view.emit("${this.name}.$name", payload)

  override fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) =
    view.ask("${this.name}.$name", payload, onAnswer)
}

// Concurrent: shouldInterceptRequest asks on Chromium's IO thread while the main thread fills it.
private val overrideCache = ConcurrentHashMap<String, Boolean>()
private val BASES = setOf<Class<*>>(WebViewClient::class.java, WebChromeClient::class.java, WebViewClientCompat::class.java)

/**
 * WebViewClientCompat's own overrides that only forward to a variant of the callback (the first two are final): the
 * variant's parameter types, by the callback's signature.
 */
private val COMPAT_VARIANTS: Map<String, Array<Class<*>>> = mapOf(
  signature("onReceivedError", WebView::class.java, WebResourceRequest::class.java, WebResourceError::class.java) to
    arrayOf(WebView::class.java, WebResourceRequest::class.java, WebResourceErrorCompat::class.java),
  signature("onSafeBrowsingHit", WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponse::class.java) to
    arrayOf(WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponseCompat::class.java),
  signature("shouldOverrideUrlLoading", WebView::class.java, WebResourceRequest::class.java) to
    arrayOf(WebView::class.java, String::class.java)
)

private fun signature(callback: String, vararg types: Class<*>) = "$callback(${types.joinToString { it.name }})"

/** Whether this client's class overrides the callback [callback] taking [types]; the base classes' own methods don't count. */
internal fun Any.overrides(callback: String, vararg types: Class<*>): Boolean = javaClass.overrides(callback, *types)

/**
 * [Any.overrides] for the class. A WebViewClientCompat subclass that leaves one of the compat class's forwarding
 * overrides in place (COMPAT_VARIANTS) overrides the callback only through the variant the forwarder calls.
 */
internal fun Class<*>.overrides(callback: String, vararg types: Class<*>): Boolean =
  overrideCache.getOrPut("${this.name}#${signature(callback, *types)}") {
    val declared = getMethod(callback, *types).declaringClass
    if (declared != WebViewClientCompat::class.java) return@getOrPut declared !in BASES
    val variant = COMPAT_VARIANTS[signature(callback, *types)] ?: return@getOrPut false
    getMethod(callback, *variant).declaringClass !in BASES
  }
