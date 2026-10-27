package expo.modules.minimalwebview

import android.content.Context
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
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
 * Native hooks: Kotlin in an app's or a package's own Expo module that gets the real [WebView] behind this package's
 * WebViews and chains its own clients to it, with no protocol to implement. `example/modules/sample-extension` has
 * complete ones.
 *
 * Leave alone what the core owns: the WebView's own client slots (add to [WebViewContext.clients] and
 * [WebViewContext.chromeClients] instead), the bridge's web message listener and document-start scripts, and the
 * download listener.
 */
object MinimalWebViewHooks {
  /** Makes each WebView: the first one, and a new one after the render process dies. A subclass can override what WebView lets it. */
  var webViewFactory: (Context) -> WebView = { WebView(it) }

  internal class Hook(
    val key: String,
    val configure: ((WebView, WebViewContext) -> Unit)?,
    val attach: (WebView, WebViewContext) -> (() -> Unit)?
  )

  internal val hooks = mutableListOf<Hook>()

  /**
   * Registers the hook for [key], from your module's `OnCreate`, before the first WebView. Keys are global: a second
   * registration under a key replaces the first and logs a warning, so prefix yours with your package's name. `core`
   * is reserved and refused. Hooks run in registration order, so an earlier hook's clients come first.
   *
   * The hook attaches to a WebView created with a `hookOptions` value for [key] other than null, undefined or false,
   * and again, with the current value, to the WebView that replaces it after a renderer crash. A key added to
   * `hookOptions` later attaches nothing (a warning says so): to switch a hook on and off, enable its key from the
   * start and put the switch in its value (`{ enabled: false }`), or give the WebView a new React `key`. A key that
   * enables no registered hook (a typo, or a module not linked or not rebuilt) warns too, so pass a one-platform hook's
   * key on that platform only.
   *
   * @param configure runs on the main thread as soon as each WebView is made, before the package sets it up
   *   (`WebViewCompat.setProfile` goes here).
   * @param attach runs on the main thread once the WebView has its settings and is in the view hierarchy, so what it
   *   sets wins over the settings it was created with. It returns what to run when that WebView goes away, after the
   *   [WebViewContext.onDocumentEnd] that gives the reason, or null.
   */
  fun register(
    key: String,
    configure: ((WebView, WebViewContext) -> Unit)? = null,
    attach: (WebView, WebViewContext) -> (() -> Unit)?
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

internal fun enables(value: Any?) = value != null && value != false

/**
 * Which [hooks] attach to a WebView created with the enabled `hookOptions` [keys]: the ones registered under them, in
 * registration order. Second, the keys no hook is registered under.
 */
internal fun selectHooks(hooks: List<MinimalWebViewHooks.Hook>, keys: Set<String>) =
  hooks.filter { it.key in keys }.let { attaching -> attaching to keys - attaching.map { it.key }.toSet() }

/**
 * Whether a `hookOptions` change from [old] to [value] turns on [key], one the WebView was not created with ([keys]):
 * no hook attaches for it, and a warning says so.
 */
internal fun addedLate(key: String, old: Any?, value: Any?, keys: Set<String>) =
  key !in keys && !enables(old) && enables(value)

/**
 * One WebView as one hook sees it. Each attach gets a new context, and the handlers registered on it belong to that
 * attach: after a renderer crash, the new WebView's `attach` registers them again. [emit] and [ask] can be called from
 * any thread, the rest from the main thread, where the handlers and the answers run. A context kept after its view
 * closed does nothing.
 */
interface WebViewContext {
  /**
   * This hook's `hookOptions` value, in JSON types: a number is a `Double`, an object a `Map`, an array a `List`.
   * After a change it is the new value, already when the [onOptionsChange] handlers run.
   */
  val options: Any?

  /**
   * The committed URL, the one the navigation state reports; empty before the first commit. Inside [onDocumentEnd] it
   * is still the page that ended.
   */
  val url: String

  /**
   * The hook clients, in order; add yours in `attach`. A callback that returns a decision (the `deciding` calls in
   * MinimalWebViewClients.kt) goes to the first client that overrides it, instead of the core and the app's props: a
   * client that overrides `shouldOverrideUrlLoading` decides navigations instead of the navigation rules, which still
   * decide new windows unless a chrome client overrides `onCreateWindow`. Every other callback reaches the core first,
   * then each client that overrides it. `shouldInterceptRequest` runs on a background thread.
   *
   * Overriding a variant the base class forwards to counts as overriding the callback: `WebViewClientCompat`'s
   * `onReceivedError`, `onSafeBrowsingHit` and `shouldOverrideUrlLoading(WebView, String)`, and the platform's
   * deprecated `shouldOverrideUrlLoading(WebView, String)`, `shouldInterceptRequest(WebView, String)` and 4-argument
   * `onReceivedError`.
   */
  val clients: MutableList<WebViewClient>

  /**
   * The hook chrome clients, routed as [clients] are. Overriding the deprecated `onConsoleMessage(String, Int, String)`
   * counts as overriding `onConsoleMessage`, and overriding `onReceivedIcon` turns favicon downloads back on.
   */
  val chromeClients: MutableList<WebChromeClient>

  /** Sends `onHookEvent({ name: "<key>.<name>", payload })` to JS. */
  fun emit(name: String, payload: Map<String, Any?>)

  /**
   * Sends the event and waits for JS's answer: the `onHookEvent` handler's return value, a promise awaited. A throw or
   * no handler answers null. There is no timeout: an ask still open when the Document ends answers null, and one made
   * after the view closed answers null at once. A number answers as a `Double`.
   */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)

  /**
   * Runs [handler] with this hook's new `hookOptions` value each time it changes, live on the same WebView; null when
   * the key is removed.
   */
  fun onOptionsChange(handler: (Any?) -> Unit)

  /**
   * Runs [handler] at each end of the Document ([DocumentScope]), after the core's own resets: per-page state belongs
   * here.
   */
  fun onDocumentEnd(handler: (DocumentScope.End) -> Unit)

  /**
   * Answers JS's `ref.hook("<key>", method, args)`. [handler] gets the arguments in JSON types (a number as an `Int`,
   * `Long` or `Double`) and calls `reply` once, with a value JSON can encode. One handler per method: the last one
   * wins. The promise rejects with `hook_not_handled` when no attached hook under the key handles the method, and
   * stays pending when a handler never replies, past the Document's end, a crash or unmount too.
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
  override val url get() = view.url
  override val clients get() = view.clients
  override val chromeClients get() = view.chromeClients
  private val optionsHandlers = mutableListOf<(Any?) -> Unit>()
  private val documentEndHandlers = mutableListOf<(DocumentScope.End) -> Unit>()
  val handlers = mutableMapOf<String, (List<Any?>, (Any?) -> Unit) -> Unit>()

  override fun emit(name: String, payload: Map<String, Any?>) = onMain { view.emit("$key.$name", payload) }

  override fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) =
    onMain { view.asks.ask("$key.$name", payload, onAnswer) }

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
 * The base classes' own methods that only forward to a variant of the callback: the variant's parameter types, by the
 * declaring class and the callback's signature. WebViewClient's and WebChromeClient's forward to a deprecated variant;
 * WebViewClientCompat's first two are final.
 */
private val VARIANTS: Map<Class<*>, Map<String, Array<Class<*>>>> = mapOf(
  WebViewClient::class.java to mapOf(
    signature("shouldOverrideUrlLoading", WebView::class.java, WebResourceRequest::class.java) to
      arrayOf(WebView::class.java, String::class.java),
    signature("shouldInterceptRequest", WebView::class.java, WebResourceRequest::class.java) to
      arrayOf(WebView::class.java, String::class.java),
    signature("onReceivedError", WebView::class.java, WebResourceRequest::class.java, WebResourceError::class.java) to
      arrayOf(WebView::class.java, Integer.TYPE, String::class.java, String::class.java)
  ),
  WebChromeClient::class.java to mapOf(
    signature("onConsoleMessage", ConsoleMessage::class.java) to arrayOf(String::class.java, Integer.TYPE, String::class.java)
  ),
  WebViewClientCompat::class.java to mapOf(
    signature("onReceivedError", WebView::class.java, WebResourceRequest::class.java, WebResourceError::class.java) to
      arrayOf(WebView::class.java, WebResourceRequest::class.java, WebResourceErrorCompat::class.java),
    signature("onSafeBrowsingHit", WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponse::class.java) to
      arrayOf(WebView::class.java, WebResourceRequest::class.java, Integer.TYPE, SafeBrowsingResponseCompat::class.java),
    signature("shouldOverrideUrlLoading", WebView::class.java, WebResourceRequest::class.java) to
      arrayOf(WebView::class.java, String::class.java)
  )
)

private fun signature(callback: String, vararg types: Class<*>) = "$callback(${types.joinToString { it.name }})"

/** Whether this client's class overrides the callback [callback] taking [types]; the base classes' own methods don't count. */
internal fun Any.overrides(callback: String, vararg types: Class<*>): Boolean = javaClass.overrides(callback, *types)

/**
 * [Any.overrides] for the class. A subclass that leaves one of the base classes' forwarding methods in place
 * (VARIANTS) overrides the callback only through the variant the forwarder calls.
 */
internal fun Class<*>.overrides(callback: String, vararg types: Class<*>): Boolean =
  overrideCache.getOrPut("${this.name}#${signature(callback, *types)}") {
    val declared = getMethod(callback, *types).declaringClass
    if (declared !in BASES) return@getOrPut true
    val variant = VARIANTS[declared]?.get(signature(callback, *types)) ?: return@getOrPut false
    getMethod(callback, *variant).declaringClass !in BASES
  }
