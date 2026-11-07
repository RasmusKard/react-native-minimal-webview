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

/**
 * Native hooks: Kotlin in an app's or a package's own Expo module that gets the real [WebView] behind this package's
 * WebViews and chains its own clients to it, with no protocol to implement.
 *
 * The [native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
 * walks through one.
 *
 * Leave alone what the core owns: the WebView's own client slots (add to [WebViewContext.clients] and
 * [WebViewContext.chromeClients] instead), its touch and scroll-change listeners ([WebViewContext.touchListeners] and
 * [WebViewContext.scrollListeners]), the bridge's web message listener and document-start scripts, and the download
 * listener ([WebViewContext.onDownloadStart]).
 */
object MinimalWebViewHooks {
  internal class Hook(
    val key: String,
    val webViewFactory: ((Context) -> WebView)?,
    val configure: ((WebView, WebViewContext) -> Unit)?,
    val attach: (WebView, WebViewContext) -> Unit
  )

  internal val hooks = mutableListOf<Hook>()

  /**
   * Registers the hook for [key]. Call it from your module's `OnCreate`, before the first WebView.
   *
   * The same `register` call running again replaces its hook: a JS reload creates the modules anew and runs their
   * `OnCreate` again. A helper that calls `register` for other code is one call, so a second hook through it replaces
   * the first silently.
   *
   * The hook attaches to each WebView whose `extensions` prop has an extension with [key] that is on;
   * [HookExtension.options](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
   * says when. After a renderer crash it attaches again, to the WebView that replaces the dead one.
   *
   * Hooks attach in registration order, which across packages is autolinking's (packages sorted by name), so an
   * earlier hook's clients come first. A hook whose key turns on after the WebView was created attaches after the
   * hooks attached already; after a crash it takes its place in registration order again.
   *
   * @param key the key of the app's extension that turns on the hook. Keys are global, so prefix yours with your
   *   package's name. `core` is reserved for the package's own events: a hook under it is logged and not registered.
   * @param webViewFactory makes each WebView this hook is attached to, on or off: the first one and each after a
   *   renderer crash, as a subclass that overrides what WebView lets a subclass override. Null leaves it to the other
   *   hooks. When the attached hooks name different factories (the same object is one), the first one's in
   *   registration order makes the WebView, and a `core.warning` names the others. Those still attach, so check the
   *   class `attach` gets.
   * @param configure runs on the main thread as soon as each WebView this hook is attached to, on or off, is made,
   *   before the package sets it up ([WebViewCompat.setProfile][androidx.webkit.WebViewCompat.setProfile] goes here).
   *   It gets the same context that [attach] gets next for that WebView, so state it makes can be keyed by the context.
   * @param attach runs on the main thread once the WebView has its settings and is in the view hierarchy, so what it
   *   sets wins over those settings. Register what to run when that WebView goes away with
   *   [WebViewContext.onDestroyed]. Document-start scripts you add here run before the package's, so
   *   `window.nativeBridge` and `injectedScripts` aren't there yet (on iOS yours run after them).
   * @throws IllegalStateException when a different hook is registered under [key] already. Don't rely on it: a minified
   *   build can't tell the two apart and may replace the first hook instead, so give each hook its own key.
   */
  fun register(
    key: String,
    webViewFactory: ((Context) -> WebView)? = null,
    configure: ((WebView, WebViewContext) -> Unit)? = null,
    attach: (WebView, WebViewContext) -> Unit
  ) {
    if (key == "core") {
      Log.e(TAG, "the hook key `core` is reserved: the hook is not registered")
      return
    }
    val hook = Hook(key, webViewFactory, configure, attach)
    val index = hooks.indexOfFirst { it.key == key }
    if (index < 0) {
      hooks += hook
      return
    }
    // Each lambda in the source compiles to a class of its own: the same class is the same call running again.
    // shortcut: R8 can merge two lambdas' classes in a minified build; upgrade if a duplicate must throw there too.
    val first = hooks[index].attach.javaClass
    check(first == attach.javaClass) {
      "two hooks are registered under `$key` (${first.name} and ${attach.javaClass.name}): " +
        "prefix yours with your package's name"
    }
    hooks[index] = hook
  }
}

/**
 * Which [hooks] attach to a WebView created with the enabled `hookOptions` [keys]: the ones registered under them, in
 * registration order. Second, the keys no hook is registered under.
 */
internal fun selectHooks(
  hooks: List<MinimalWebViewHooks.Hook>,
  keys: Set<String>
): Pair<List<MinimalWebViewHooks.Hook>, Set<String>> {
  val attaching = hooks.filter { it.key in keys }
  return attaching to keys - attaching.map { it.key }.toSet()
}

/** [keys] in the order of the [registered] hook keys, then the keys no hook is registered under, sorted. */
internal fun inRegistrationOrder(keys: Set<String>, registered: List<String>) =
  registered.filter { it in keys } + (keys - registered.toSet()).sorted()

/**
 * Which of [attaching] makes the WebView: the first with a factory, or null for a plain WebView. Second, the keys of the
 * others whose factory is a different object.
 */
internal fun pickFactory(attaching: List<MinimalWebViewHooks.Hook>): Pair<MinimalWebViewHooks.Hook?, List<String>> {
  val named = attaching.filter { it.webViewFactory != null }
  val maker = named.firstOrNull()
  return maker to named.filter { it.webViewFactory !== maker?.webViewFactory }.map { it.key }
}

/**
 * Picks the hook client that gets a decision callback: the first of the clients that override it. It calls [warn] with
 * a `core.warning` message naming the callback, once per callback and reason: when more than one client overrides it,
 * and when one takes a decision the core makes from the app's props or their defaults ([TAKEN]).
 */
internal class Deciders(private val warn: (String) -> Unit) {
  // Concurrent: shouldInterceptRequest decides on Chromium's IO thread.
  private val warned = ConcurrentHashMap.newKeySet<String>()

  fun <T> first(callback: String, clients: List<T>, overrides: (T) -> Boolean): T? {
    val overriding = clients.filter(overrides)
    if (overriding.size > 1 && warned.add(callback)) {
      warn("$callback: more than one hook client overrides it; only the first one gets it")
    }
    val lost = TAKEN[callback]
    if (lost != null && overriding.isNotEmpty() && warned.add("$callback taken")) {
      warn("$callback: a hook client takes it, so $lost")
    }
    return overriding.firstOrNull()
  }

  private companion object {
    /** The decisions the core makes from the app's props or their defaults, by callback: what stops applying. */
    val TAKEN = mapOf(
      "shouldOverrideUrlLoading" to "navigationRules, their defaults and onNavigationRequest don't apply to navigations",
      "onCreateWindow" to "navigationRules, their defaults and onNavigationRequest don't apply to new windows",
      "onReceivedSslError" to "the core doesn't cancel SSL errors or report them to onError",
      "onPermissionRequest" to "onPermissionRequest and the default deny don't apply",
      "onGeolocationPermissionsShowPrompt" to "onPermissionRequest and the default deny don't apply to location",
      "onShowFileChooser" to "onFileRequest doesn't apply",
      "onShowCustomView" to "the core's fullscreen and onFullscreenChange don't apply"
    )
  }
}

/**
 * One WebView as one hook sees it, for one attach.
 *
 * Each attach gets a new context, and the handlers registered on it belong to that attach: after a renderer crash, the
 * new WebView's `attach` registers them again.
 *
 * Call [emit] and [ask] from any thread, and the rest on the main thread, where the handlers and the answers run.
 *
 * The hook is on while its extension's `options` are not null or false;
 * [HookExtension.options](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
 * says what off means. [onOptionsChange] still runs while it is off, so the hook can release what it holds, and again
 * when the hook turns on.
 *
 * A context kept after its attach ended (the view closed, or a renderer crash replaced the WebView) does nothing: its
 * lists reach no WebView and its [emit] reaches nothing.
 */
interface WebViewContext {
  /**
   * This hook's extension's `options`, the new ones after a change; null while the hook is off.
   *
   * They come in JSON types: a number as a `Double`, an object as a `Map`, an array as a `List`. After a change they
   * are the new value already when the [onOptionsChange] handlers run.
   */
  val options: Any?

  /**
   * The committed URL, the one `useWebViewState` reports; empty before the first commit.
   *
   * Inside [onDocumentEnd] it is still the page that ended. With WebView 146 and later, `onPageStarted` comes after the
   * commit that ends the Document, so `url` is already the new page there.
   */
  val url: String

  /**
   * The hook clients, in order; add yours in `attach`. While the hook is off, none of them gets a callback.
   *
   * Each callback reaches the clients by one of these rules:
   * - A callback that returns a decision goes to the first client that overrides it, instead of the core and the
   *   app's props.
   * - Every other callback reaches the core first, then each client that overrides it.
   *
   * Taking a decision the core makes from the app's props or their defaults switches them off, the default navigation
   * rules' security checks included, and a `core.warning` names the callback and what stops applying.
   *
   * A client that overrides `shouldOverrideUrlLoading` decides navigations instead of the navigation rules, which still
   * decide new windows unless a chrome client overrides `onCreateWindow`. A new window the rules allow loads in place
   * with `loadUrl`, which doesn't reach `shouldOverrideUrlLoading` (on iOS that load reaches the deciding delegate).
   *
   * A decision more than one client overrides still goes only to the first, and a `core.warning` names it. Each warning
   * comes once per WebView, when its decision first comes.
   *
   * Overriding a variant the base class forwards to counts as overriding the callback: [WebViewClientCompat]'s
   * `onReceivedError`, `onSafeBrowsingHit` and `shouldOverrideUrlLoading(WebView, String)`, and the platform's
   * deprecated `shouldOverrideUrlLoading(WebView, String)`, `shouldInterceptRequest(WebView, String)` and 4-argument
   * `onReceivedError`.
   *
   * `shouldInterceptRequest` runs on a background thread.
   */
  val clients: MutableList<WebViewClient>

  /**
   * The hook chrome clients, routed as [clients] are.
   *
   * Overriding the deprecated `onConsoleMessage(String, Int, String)` counts as overriding `onConsoleMessage`, and
   * overriding `onReceivedIcon` turns favicon downloads back on.
   */
  val chromeClients: MutableList<WebChromeClient>

  /**
   * The hooks' touch listeners, in order, called until one returns true: that one consumes the touch, which neither the
   * later listeners nor the WebView get.
   */
  val touchListeners: MutableList<View.OnTouchListener>

  /** The hooks' scroll listeners: each one gets every scroll change, in order. */
  val scrollListeners: MutableList<View.OnScrollChangeListener>

  /**
   * Sends an event to JS as `<key>.<name>`: the extension's `onEvent` gets `{ name, payload }`, with `name` relative to
   * the key. It is dropped while the hook is off, and after the context's attach ended.
   */
  fun emit(name: String, payload: Map<String, Any?>)

  /**
   * Sends the event as [emit] does, and calls [onAnswer] with JS's answer: the extension's `onEvent` return value, a
   * promise awaited. A number answers as a `Double`.
   *
   * It answers null when the handler throws or there is none, or when the Document ends first; there is no timeout. It
   * answers null at once while the hook is off, and after the context's attach ended. An ask made before the WebView's
   * first commit (in `attach`) belongs to the Document that commit opens.
   */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)

  /**
   * Runs [handler] with this hook's extension's new `options` each time they change, live on the same WebView; null
   * when the hook turns off.
   *
   * The hook turns off when the extension is removed, or its `options` become null or false. A change from one off
   * value to another doesn't run it.
   */
  fun onOptionsChange(handler: (Any?) -> Unit)

  /**
   * Runs [handler] at each end of the Document (see [DocumentEnd]), after the core's own resets: per-page state
   * belongs here.
   */
  fun onDocumentEnd(handler: (DocumentEnd) -> Unit)

  /**
   * Runs [handler] once this attach's WebView is destroyed: with [DocumentEnd.CLOSING] at unmount, or with
   * [DocumentEnd.CRASHED] after a renderer crash. It comes after the [onDocumentEnd] handlers that get the same
   * reason, and the context does nothing by then.
   *
   * Clean up here, and release what must outlive the WebView, such as a [ProfileStore][androidx.webkit.ProfileStore]
   * profile.
   */
  fun onDestroyed(handler: (DocumentEnd) -> Unit)

  /**
   * Offers [handler] each download the page starts, with [DownloadListener][android.webkit.DownloadListener]'s
   * arguments (an unknown disposition or MIME type is empty), before the `onDownload` prop and the core's opening it
   * externally.
   *
   * Return true to take it: neither of those gets it then. The hooks that are on are offered it in registration order,
   * and the first that takes it ends the round.
   */
  fun onDownloadStart(
    handler: (url: String, userAgent: String, contentDisposition: String, mimeType: String, contentLength: Long) -> Boolean
  )

  /**
   * Answers JS's `ref.hook("<key>", method, args)`: [handler] gets the arguments and calls `reply` exactly once.
   *
   * The arguments come in JSON types (a number as an `Int`, `Long` or `Double`), and the reply must be a value JSON can
   * encode. One handler per method: the last one wins.
   *
   * A handler that throws, or a reply JSON can't encode, rejects the JS call with `native_error`. A handler that never
   * replies leaves the call waiting until the WebView unmounts: a navigation or a crash doesn't settle it.
   */
  fun handle(method: String, handler: (args: List<Any?>, reply: (Any?) -> Unit) -> Unit)
}

/**
 * [HookContext]'s base: the hook's `hookOptions` value (null while its key is absent), its lists, and whether the core
 * routes them. Chromium's IO thread reads [routed] and [clients] (shouldInterceptRequest), so [options] and the detach
 * are volatile; the rest is main thread only.
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
  // Copy-on-write too: the core iterates them live, and a listener may remove itself while it runs.
  val touchListeners: MutableList<View.OnTouchListener> = CopyOnWriteArrayList()
  val scrollListeners: MutableList<View.OnScrollChangeListener> = CopyOnWriteArrayList()

  /** Whether the hook is on and the attach is still there: the core routes the lists and passes events and asks. */
  val routed get() = options != null && !detached

  fun onOptionsChange(handler: (Any?) -> Unit) {
    optionsHandlers += handler
  }

  /** The hook's new `hookOptions` [value], null when its key is gone; the view calls it only for a changed value. */
  fun optionsChanged(value: Any?) {
    options = value
    optionsHandlers.forEach { it(value) }
  }

  /** The attach ended: the core routes nothing of it, and the emits and asks that follow reach nothing. */
  fun detach() {
    detached = true
  }

  fun onDownloadStart(handler: (String, String, String, String, Long) -> Boolean) {
    downloadHandlers += handler
  }

  /** Whether one of the download handlers took the download; none is offered it while the hook is off or detached. */
  fun downloadStarted(url: String, userAgent: String, contentDisposition: String, mimeType: String, contentLength: Long) =
    routed && downloadHandlers.any { it(url, userAgent, contentDisposition, mimeType, contentLength) }

  fun ifRouted(send: () -> Unit) {
    if (routed) send()
  }

  fun askIfRouted(onAnswer: (Any?) -> Unit, send: () -> Unit) {
    if (routed) send() else onAnswer(null)
  }
}

/** The lists [pick] takes from the [attachments] that are [routed][Attachment.routed], one after the other. */
internal fun <T> routed(attachments: List<Attachment>, pick: (Attachment) -> List<T>) =
  attachments.filter { it.routed }.flatMap(pick)

/**
 * A hook's view of the WebView, one per hook and WebView: the core's context with the hook's key on its events. The
 * handlers live here, so the WebView after a crash gets the ones its `attach` registers again.
 */
internal class HookContext(val hook: MinimalWebViewHooks.Hook, private val view: MinimalWebView) :
  Attachment(view.hookOptions[hook.key]), WebViewContext {
  val key get() = hook.key
  override val url get() = view.url
  private val documentEndHandlers = mutableListOf<(DocumentEnd) -> Unit>()
  private val destroyedHandlers = mutableListOf<(DocumentEnd) -> Unit>()
  val handlers = mutableMapOf<String, (List<Any?>, (Any?) -> Unit) -> Unit>()

  override fun emit(name: String, payload: Map<String, Any?>) =
    onMain { ifRouted { view.emit("$key.$name", payload) } }

  override fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) =
    onMain { askIfRouted(onAnswer) { view.asks.ask("$key.$name", payload, onAnswer) } }

  override fun onDocumentEnd(handler: (DocumentEnd) -> Unit) {
    documentEndHandlers += handler
  }

  override fun onDestroyed(handler: (DocumentEnd) -> Unit) {
    destroyedHandlers += handler
  }

  override fun handle(method: String, handler: (args: List<Any?>, reply: (Any?) -> Unit) -> Unit) {
    handlers[method] = handler
  }

  fun documentEnded(reason: DocumentEnd) = documentEndHandlers.forEach { it(reason) }

  fun destroyed(reason: DocumentEnd) = destroyedHandlers.forEach { it(reason) }

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
  overrideCache.getOrPut("$name#${signature(callback, *types)}") {
    val declared = getMethod(callback, *types).declaringClass
    if (declared !in BASES) return@getOrPut true
    val variant = VARIANTS[declared]?.get(signature(callback, *types)) ?: return@getOrPut false
    getMethod(callback, *variant).declaringClass !in BASES
  }
