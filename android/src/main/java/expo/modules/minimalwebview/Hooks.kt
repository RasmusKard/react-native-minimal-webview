package expo.modules.minimalwebview

import android.content.Context
import android.os.Looper
import android.util.Log
import android.view.View
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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Registers native hooks. A native hook is Kotlin in your own Expo module that gets the real [WebView] behind each
 * `<WebView>` and adds its own clients to it.
 *
 * **Important:** leave alone what the core owns:
 * - The WebView's client and chrome client. Add yours to [WebViewContext.clients] and [WebViewContext.chromeClients].
 * - Its touch and scroll-change listeners. Add yours to [WebViewContext.touchListeners] and
 *   [WebViewContext.scrollListeners].
 * - Its download listener. Use [WebViewContext.onDownloadStart].
 * - The bridge's web message listener and document-start scripts.
 * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 */
object MinimalWebViewHooks {
  internal class Hook(
    val key: String,
    val webViewFactory: ((Context) -> WebView)?,
    val configure: ((WebView, WebViewContext) -> Unit)?,
    val newWebViewsOnly: Boolean,
    val attach: (WebView, WebViewContext) -> Unit
  ) {
    val whyNotLate get() = when {
      configure != null -> "configure"
      webViewFactory != null -> "a webViewFactory"
      newWebViewsOnly -> "newWebViewsOnly"
      else -> null
    }
  }

  internal val hooks = mutableListOf<Hook>()

  /**
   * Registers the hook for [key]. Call it from your module's `OnCreate`, before the first WebView.
   *
   * Registering a key that is taken replaces the earlier hook in its place and logs a warning.
   *
   * The hook attaches to each WebView whose `extensions` prop holds an extension with [key] that is on.
   * [HookExtension.options](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
   * says when an extension is on. After a renderer crash, the hook attaches again to the WebView that replaces the
   * dead one.
   *
   * Hooks attach in registration order, so an earlier hook's clients come first. Across packages, that order is
   * autolinking's. A hook whose key turns on after the WebView was created attaches after the hooks attached already.
   * After a crash, it takes its place in registration order again.
   *
   * @param key the key of the extension that turns the hook on. Every package shares one set of keys, so prefix yours
   *   with your package's name. `core` is reserved, so a hook under it is logged and not registered.
   * @param webViewFactory makes the WebView, so that it can be your own subclass. It makes each WebView this hook is
   *   attached to, whether the hook is on or off, at mount and after each renderer crash. Null leaves the WebView to
   *   the other hooks. When the attached hooks pass different factories, the first in registration order makes the
   *   WebView and a warning names the others. Those hooks still attach, so check the class that `attach` gets.
   * @param configure runs on the main thread as soon as each WebView this hook is attached to is made, whether the hook
   *   is on or off, and before the package sets the WebView up. If you set a profile with
   *   [WebViewCompat.setProfile][androidx.webkit.WebViewCompat.setProfile], do it here. It gets the same context that
   *   [attach] gets next for that WebView, so you can key state by the context.
   * @param newWebViewsOnly true attaches the hook only when a WebView is created, never to one whose key turns on
   *   later. A hook with [configure] or [webViewFactory] always behaves this way.
   * @param attach runs on the main thread once the WebView has its settings and is in the view hierarchy, so what it
   *   sets overrides those settings. Register cleanup with [WebViewContext.onDestroyed]. Document-start scripts you add
   *   here run before the package's, so `window.nativeBridge` isn't defined and the `injectedScripts` haven't run yet.
   */
  fun register(
    key: String,
    webViewFactory: ((Context) -> WebView)? = null,
    configure: ((WebView, WebViewContext) -> Unit)? = null,
    newWebViewsOnly: Boolean = false,
    attach: (WebView, WebViewContext) -> Unit
  ) {
    if (key == "core") {
      Log.e(TAG, "the hook key `core` is reserved: the hook is not registered")
      return
    }
    if (putHook(hooks, Hook(key, webViewFactory, configure, newWebViewsOnly, attach))) {
      Log.w(
        TAG,
        "a hook under `$key` replaces the one registered before: a JS reload registers every hook again; " +
          "otherwise two hooks share the key and the last one wins, so prefix yours with your package's name"
      )
    }
  }
}

/** Adds [hook] to [hooks], or replaces the one under its key in place; returns whether it replaced one. */
internal fun putHook(hooks: MutableList<MinimalWebViewHooks.Hook>, hook: MinimalWebViewHooks.Hook): Boolean {
  val index = hooks.indexOfFirst { it.key == hook.key }
  if (index < 0) hooks += hook else hooks[index] = hook
  return index >= 0
}

/** Splits [keys] into the [hooks] registered under them, in registration order, and the keys no hook is registered under. */
internal fun selectHooks(
  hooks: List<MinimalWebViewHooks.Hook>,
  keys: Set<String>
): Pair<List<MinimalWebViewHooks.Hook>, Set<String>> {
  val attaching = hooks.filter { it.key in keys }
  return attaching to keys - attaching.map { it.key }.toSet()
}

/** [keys] in registration order, then those no hook is registered under, sorted. */
internal fun inRegistrationOrder(keys: Set<String>, registered: List<String>) =
  registered.filter { it in keys } + (keys - registered.toSet()).sorted()

/** The hook whose factory makes the WebView (null: a plain one), and the keys of the others with a different factory. */
internal fun pickFactory(attaching: List<MinimalWebViewHooks.Hook>): Pair<MinimalWebViewHooks.Hook?, List<String>> {
  val named = attaching.filter { it.webViewFactory != null }
  val maker = named.firstOrNull()
  return maker to named.filter { it.webViewFactory !== maker?.webViewFactory }.map { it.key }
}

/**
 * Picks the first of the clients that override a decision callback, or null. Calls [warn] once per callback and reason:
 * - more than one client overrides the callback;
 * - a client takes it, when the caller passes `lost`: what stops applying, the app's props or their defaults that would decide it otherwise.
 */
internal class Deciders(private val warn: (String) -> Unit) {
  // Concurrent: shouldInterceptRequest decides on Chromium's IO thread.
  private val warned = ConcurrentHashMap.newKeySet<String>()

  fun <T> first(callback: String, clients: List<T>, lost: String? = null, overrides: (T) -> Boolean): T? {
    val overriding = clients.filter(overrides)
    if (overriding.size > 1 && warned.add(callback)) {
      warn("$callback: more than one hook client overrides it; only the first one gets it")
    }
    if (lost != null && overriding.isNotEmpty() && warned.add("$callback taken")) {
      warn("$callback: a hook client takes it, so $lost")
    }
    return overriding.firstOrNull()
  }
}

/**
 * A hook's view of one WebView, for one attach.
 *
 * Each attach gets a new context, and the handlers registered on it belong to that attach. After a renderer crash,
 * `attach` runs for the new WebView and registers them again.
 *
 * Call [emit] and [ask] from any thread, and the other members on the main thread, where the handlers and the answers
 * run.
 *
 * Values from JS arrive in JSON types: a number as a `Double`, an object as a `Map<String, Any?>`, an array as a
 * `List<Any?>`, and a string, a boolean and null as themselves. This applies to the [options], an [ask]'s answer and
 * a [handle] handler's arguments.
 *
 * [HookExtension.options](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
 * says when the hook is on.
 *
 * An attach ends when the view closes or a renderer crash replaces the WebView. A context kept after that does nothing
 * and holds no reference to the WebView.
 * @see [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 */
interface WebViewContext {
  /**
   * This hook's extension's current `options`, or null while the hook is off. They hold the new value already when the
   * [onOptions] handlers run.
   */
  val options: Any?

  /**
   * The committed URL, the one `useWebViewState` reports. It is empty before the first commit and after the attach
   * ended.
   *
   * Inside [onDocumentEnd] it is still the page that ended. In a client's `onPageStarted` it may already be the new
   * page.
   */
  val url: String

  /**
   * Your clients, in order. Add them in `attach`. While the hook is off, none of them gets a callback.
   *
   * Each callback reaches the clients by one of these rules:
   * - A callback that decides something goes to the first client that overrides it, instead of the core and the app's
   *   props. It decides by its return value, or through the handler, request or callback it gets, as
   *   `onReceivedSslError`, `onReceivedHttpAuthRequest` and `onReceivedClientCertRequest` do.
   * - Every other callback reaches the core first, then each client that overrides it.
   * - `onRenderProcessGone` is the exception. It reaches every client that overrides it, and the core returns true and
   *   replaces the WebView, so the clients' return values are ignored.
   *
   * A client that takes a decision the core makes from the app's props or their defaults switches those off, including
   * the default navigation rules' security checks. A warning names the callback and what stops applying.
   *
   * A client that overrides `shouldOverrideUrlLoading` decides navigations instead of the navigation rules. The rules
   * still decide new windows unless a chrome client overrides `onCreateWindow`. A new window the rules allow loads in
   * place, and that load doesn't reach `shouldOverrideUrlLoading`.
   *
   * When more than one client overrides a decision, only the first gets it, and a warning names the callback. Each
   * warning comes once per WebView, the first time its callback comes.
   *
   * Overriding a variant that the base class forwards to counts as overriding the callback. The variants are:
   * - [WebViewClientCompat]'s `onReceivedError`, `onSafeBrowsingHit` and `shouldOverrideUrlLoading(WebView, String)`.
   * - The platform's deprecated `shouldOverrideUrlLoading(WebView, String)`, `shouldInterceptRequest(WebView, String)`
   *   and 4-argument `onReceivedError`.
   */
  val clients: MutableList<WebViewClient>

  /**
   * Your chrome clients, routed as [clients] are.
   *
   * Overriding the deprecated `onConsoleMessage(String, Int, String)` counts as overriding `onConsoleMessage`. The core
   * turns favicon downloads off, so `onReceivedIcon` gets no icon until `attach` turns `downloadFaviconsEnabled` back
   * on.
   */
  val chromeClients: MutableList<WebChromeClient>

  /**
   * Your touch listeners, called in order until one returns true. That listener consumes the touch, and neither the
   * later listeners nor the WebView get it.
   */
  val touchListeners: MutableList<View.OnTouchListener>

  /** Your scroll listeners, in order. Each one gets every scroll change. */
  val scrollListeners: MutableList<View.OnScrollChangeListener>

  /**
   * Sends an event to JS. The extension with this hook's key gets `{ name, payload }` in its `onEvent`. The event is
   * dropped while the hook is off and after the attach ended.
   */
  fun emit(name: String, payload: Map<String, Any?>)

  /**
   * Sends the event as [emit] does, but to the extension's `onAsk` when it has one, and calls [onAnswer] with the
   * handler's return value. A promise it returns is awaited.
   *
   * [onAnswer] gets null when the handler throws, when there is no handler, or when the Document ends first. There is
   * no timeout. It gets null at once while the hook is off and after the attach ended. An ask made before the WebView's
   * first commit, as in `attach`, belongs to the Document that commit opens.
   */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)

  /**
   * Runs [handler] at once with this hook's extension's `options`, then with the new options each time they change, on
   * the same WebView. It gets null when the hook turns off, so it can release what it holds.
   *
   * A change from one off value to another doesn't run it, and nothing runs it after the attach ended.
   */
  fun onOptions(handler: (options: Any?) -> Unit)

  /**
   * Runs [handler] each time the Document ends, after the core has reset its own per-page state. Reset your per-page
   * state here.
   */
  fun onDocumentEnd(handler: (DocumentEnd) -> Unit)

  /**
   * Runs [handler] once this attach's WebView is destroyed, with [DocumentEnd.CLOSING] at unmount or
   * [DocumentEnd.CRASHED] after a renderer crash. It runs after the [onDocumentEnd] handlers that get the same reason,
   * and the context does nothing by then.
   *
   * Clean up here, including what would otherwise outlive the WebView, such as a
   * [ProfileStore][androidx.webkit.ProfileStore] profile.
   */
  fun onDestroyed(handler: (DocumentEnd) -> Unit)

  /**
   * Offers [handler] each download the page starts, before the `onDownload` prop gets it and before the core opens it
   * externally. The handler gets [DownloadListener][android.webkit.DownloadListener]'s arguments, with an empty string
   * for an unknown disposition or MIME type.
   *
   * Return true to take the download, and then neither the prop nor the core gets it. The hooks that are on are
   * offered it in the order they attached, which is registration order and then the hooks attached later. The first
   * one that takes it ends the round.
   */
  fun onDownloadStart(
    handler: (url: String, userAgent: String, contentDisposition: String, mimeType: String, contentLength: Long) -> Boolean
  )

  /**
   * Answers JS's `ref.hook("<key>", method, args)` for [method]. [handler] gets the arguments and a [HookReply], which
   * it calls with the reply or [fails][HookReply.fail], at once or later. A later handler for the same method replaces
   * the earlier one.
   *
   * A handler that throws before it replies rejects the JS call with `handler_error` and the exception's message. A
   * handler that never replies leaves the call pending until the WebView unmounts. A navigation or a crash doesn't
   * settle it.
   */
  fun handle(method: String, handler: (args: List<Any?>, reply: HookReply) -> Unit)
}

/**
 * The reply to one JS `ref.hook` call, which a [WebViewContext.handle] handler gets. Call it with the value the call
 * resolves with, or [fail] it.
 *
 * Only the first reply or fail counts, and any later one does nothing. Call it from any thread.
 */
class HookReply internal constructor(
  private val resolve: (Any?) -> Unit,
  private val reject: (String) -> Unit
) : (Any?) -> Unit {
  private val settled = AtomicBoolean()

  /**
   * Resolves the JS call with [value], converted as
   * [ref.call's results](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#call)
   * are. A primitive array such as `IntArray` arrives as null, and a non-finite number rejects the call with
   * `native_error` instead.
   */
  override fun invoke(value: Any?) {
    if (settled.compareAndSet(false, true)) resolve(value)
  }

  /** Rejects the JS call with `handler_error` and [message]. */
  fun fail(message: String) {
    if (settled.compareAndSet(false, true)) reject(message)
  }
}

/**
 * Chromium's IO thread reads [routed] and [clients] (shouldInterceptRequest), so [options] and the detach are volatile;
 * the rest is main thread only.
 */
internal open class Attachment(value: Any?) {
  @Volatile var options: Any? = value
    private set
  @Volatile private var detached = false
  private val optionsHandlers = mutableListOf<(Any?) -> Unit>()
  private val downloadHandlers = mutableListOf<(String, String, String, String, Long) -> Boolean>()

  // Copy-on-write: Chromium reads the clients on its IO thread (shouldInterceptRequest) while attach and the hook's
  // own changes write them.
  val clients: MutableList<WebViewClient> = CopyOnWriteArrayList()
  val chromeClients = mutableListOf<WebChromeClient>()
  val touchListeners: MutableList<View.OnTouchListener> = CopyOnWriteArrayList()
  val scrollListeners: MutableList<View.OnScrollChangeListener> = CopyOnWriteArrayList()

  /** Whether the hook is on and the attach is still there: the core routes the lists and passes events and asks. */
  val routed get() = options != null && !detached

  fun onOptions(handler: (Any?) -> Unit) {
    if (detached) return
    optionsHandlers += handler
    handler(options)
  }

  /** The hook's new `hookOptions` [value], null when its key is gone; the view calls it only for a changed value. */
  fun optionsChanged(value: Any?) {
    options = value
    optionsHandlers.forEach { it(value) }
  }

  /** The attach ended: the core routes nothing of it, and the emits and asks that follow reach nothing. */
  open fun detach() {
    detached = true
    optionsHandlers.clear()
    downloadHandlers.clear()
    clients.clear()
    chromeClients.clear()
    touchListeners.clear()
    scrollListeners.clear()
  }

  fun onDownloadStart(handler: (String, String, String, String, Long) -> Boolean) {
    downloadHandlers += handler
  }

  fun downloadStarted(url: String, userAgent: String, contentDisposition: String, mimeType: String, contentLength: Long) =
    routed && downloadHandlers.any { it(url, userAgent, contentDisposition, mimeType, contentLength) }

  fun ifRouted(send: () -> Unit) {
    if (routed) send()
  }

  fun askIfRouted(onAnswer: (Any?) -> Unit, send: () -> Unit) {
    if (routed) send() else onAnswer(null)
  }
}

internal fun <T> routed(attachments: List<Attachment>, pick: (Attachment) -> List<T>) =
  attachments.filter { it.routed }.flatMap(pick)

internal class HookContext(val hook: MinimalWebViewHooks.Hook, view: MinimalWebView) :
  Attachment(view.hookOptions[hook.key]), WebViewContext {
  private var view: MinimalWebView? = view
  val key get() = hook.key
  override val url get() = view?.url.orEmpty()
  private val documentEndHandlers = mutableListOf<(DocumentEnd) -> Unit>()
  private val destroyedHandlers = mutableListOf<(DocumentEnd) -> Unit>()
  val handlers = mutableMapOf<String, (List<Any?>, HookReply) -> Unit>()

  override fun detach() {
    super.detach()
    view = null
    handlers.clear()
    documentEndHandlers.clear()
  }

  override fun emit(name: String, payload: Map<String, Any?>) =
    onMain { ifRouted { view?.emit(key, name, payload) } }

  override fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) =
    onMain { askIfRouted(onAnswer) { view?.asks?.ask(key, name, payload, onAnswer) } }

  override fun onDocumentEnd(handler: (DocumentEnd) -> Unit) {
    documentEndHandlers += handler
  }

  override fun onDestroyed(handler: (DocumentEnd) -> Unit) {
    destroyedHandlers += handler
  }

  override fun handle(method: String, handler: (args: List<Any?>, reply: HookReply) -> Unit) {
    handlers[method] = handler
  }

  fun documentEnded(reason: DocumentEnd) = documentEndHandlers.forEach { it(reason) }

  fun destroyed(reason: DocumentEnd) {
    val handlers = destroyedHandlers.toList()
    destroyedHandlers.clear()
    handlers.forEach { it(reason) }
  }

  // A hook's shouldInterceptRequest runs on Chromium's IO thread; the view's events and asks are main-thread state.
  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post { block() }
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
  overrideCache.getOrPut("$name#${signature(callback, *types)}") {
    val declared = getMethod(callback, *types).declaringClass
    if (declared !in BASES) return@getOrPut true
    val variant = VARIANTS[declared]?.get(signature(callback, *types)) ?: return@getOrPut false
    getMethod(callback, *variant).declaringClass !in BASES
  }
