package expo.modules.minimalwebview

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.util.Log
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
 * A hook is registered under the `hookOptions` key that enables it, from an Expo module's `OnCreate` (before the
 * first WebView is created), and runs for each WebView created with a value for that key other than null or false,
 * on the main thread. docs/native-hooks.md has the rules for the clients and the events.
 */
object MinimalWebViewHooks {
  /** Makes each WebView: the first one, and a new one after the render process dies. A subclass can override what WebView lets it. */
  var webViewFactory: (Context) -> WebView = { WebView(it) }

  internal class Hook(
    val key: String,
    val configure: ((WebView, WebViewContext) -> Unit)?,
    val attach: (WebView, WebViewContext) -> ((DocumentScope.End) -> Unit)?
  )

  /** In registration order: the order the hooks are configured and attached in, so which client comes first. */
  internal val hooks = mutableListOf<Hook>()

  /**
   * Registers the hook for [key]. For each new WebView (the first, and the one that replaces it after the render
   * process dies) [configure] runs as soon as it is made, before the package sets it up (`WebViewCompat.setProfile`
   * goes here), and [attach] once it has its clients and is in the view hierarchy. `attach` returns what to run when
   * that WebView goes away, which gets `CRASHED` or `CLOSING`, or null. A second registration under a key replaces the
   * first, with a warning.
   */
  fun register(
    key: String,
    configure: ((WebView, WebViewContext) -> Unit)? = null,
    attach: (WebView, WebViewContext) -> ((DocumentScope.End) -> Unit)?
  ) {
    // The package's own events are `core.…`: a hook under it would have its events taken for them.
    if (key == "core") {
      Log.e(TAG, "the hook key `core` is reserved: the hook is not registered")
      return
    }
    val hook = Hook(key, configure, attach)
    val index = hooks.indexOfFirst { it.key == key }
    if (index < 0) {
      hooks += hook
    } else {
      Log.w(TAG, "a second hook registered under `$key` replaces the first")
      hooks[index] = hook
    }
  }
}

/** Whether a `hookOptions` value enables its hook. */
internal fun enables(value: Any?) = value != null && value != false

/** One WebView instance, as a hook sees it. */
interface WebViewContext {
  /** This hook's `hookOptions` value; after a change, the new one. */
  val options: Any?
  val activity: Activity?

  /** The committed URL, the one the navigation state reports; empty before the first commit. */
  val url: String

  /**
   * Clients for the WebView, in order; add them in `attach`. A callback goes to the core, to the first client that
   * overrides it, or to every one, by the rule in docs/native-hooks.md.
   */
  val clients: MutableList<WebViewClient>
  val chromeClients: MutableList<WebChromeClient>

  /** Sends `onHookEvent({ name: "<hook>.<name>", payload })` to JS. */
  fun emit(name: String, payload: Map<String, Any?>)

  /** Sends the event and waits for JS's answer, the handler's return value; null when the view or its page goes away. */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)

  /** Runs [handler] with this hook's new `hookOptions` value each time it changes; null when the key is removed. */
  fun onOptionsChange(handler: (Any?) -> Unit)

  /** Runs [handler] at each end of the Document (GLOSSARY.md): a new page committed, a crash, or the view closing. */
  fun onDocumentEnd(handler: (DocumentScope.End) -> Unit)

  /**
   * Answers JS's `ref.hook("<hook>", method, args)`. [handler] gets the arguments as the platform's JSON types and
   * calls `reply` once, with a value JSON can encode. A later handler for the same method replaces this one.
   */
  fun handle(method: String, handler: (args: List<Any?>, reply: (Any?) -> Unit) -> Unit)
}

/**
 * A hook's view of the WebView, one per hook and WebView: the core's context with the hook's key on its events. The
 * handlers live here, so the WebView after a crash gets the ones its `attach` registers again.
 */
internal class HookContext(val hook: MinimalWebViewHooks.Hook, private val view: MinimalWebView) : WebViewContext {
  val key get() = hook.key
  private var current: Any? = view.hookOptions[hook.key]
  override val options get() = current
  override val activity get() = view.activity
  override val url get() = view.url
  override val clients get() = view.clients
  override val chromeClients get() = view.chromeClients
  private val optionsHandlers = mutableListOf<(Any?) -> Unit>()
  private val documentEndHandlers = mutableListOf<(DocumentScope.End) -> Unit>()
  val handlers = mutableMapOf<String, (List<Any?>, (Any?) -> Unit) -> Unit>()

  override fun emit(name: String, payload: Map<String, Any?>) = onMain { view.emit("$key.$name", payload) }

  override fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) =
    onMain { view.ask("$key.$name", payload, onAnswer) }

  override fun onOptionsChange(handler: (Any?) -> Unit) {
    optionsHandlers += handler
  }

  override fun onDocumentEnd(handler: (DocumentScope.End) -> Unit) {
    documentEndHandlers += handler
  }

  override fun handle(method: String, handler: (args: List<Any?>, reply: (Any?) -> Unit) -> Unit) {
    handlers[method] = handler
  }

  fun optionsChanged(value: Any?) {
    current = value
    optionsHandlers.forEach { it(value) }
  }

  fun documentEnded(reason: DocumentScope.End) = documentEndHandlers.forEach { it(reason) }

  // A hook's shouldInterceptRequest runs on Chromium's IO thread; the view's events and asks are main-thread state.
  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else view.mainHandler.post { block() }
  }
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
