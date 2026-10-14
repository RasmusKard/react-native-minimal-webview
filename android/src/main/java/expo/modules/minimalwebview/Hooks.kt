package expo.modules.minimalwebview

import android.app.Activity
import android.content.Context
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewClientCompat

/**
 * Native hooks: how an app or a package reaches the WebView this package creates, with no protocol to implement.
 * Register them from an Expo module's `OnCreate`, before the first WebView is created. They run on the main thread.
 */
object MinimalWebViewHooks {
  /** Makes each WebView: the first one, and a new one after the render process dies. A subclass can override what WebView lets it. */
  var webViewFactory: (Context) -> WebView = { WebView(it) }

  /** Puts the WebView (inside the pull-to-refresh layout, when enabled) in a container; runs for each new WebView. */
  val wrap = mutableListOf<(View, WebViewContext) -> View>()

  /**
   * Runs for each new WebView once it has its clients and is in the view hierarchy. Returns what to run when it goes
   * away (the render process died and a new one replaces it, or the view is destroyed), or null.
   */
  val attach = mutableListOf<(WebView, WebViewContext) -> (() -> Unit)?>()
}

/** One WebView instance, as the hooks see it. */
interface WebViewContext {
  /** The `nativeOptions` prop: whatever the app passed for its hooks. */
  val options: Map<String, Any?>
  val activity: Activity?

  /**
   * Clients for the WebView, in order. A callback the core doesn't implement goes to the first one that overrides it
   * (every one, when it returns nothing); a decision callback the core implements (navigation, HTTP auth, SSL,
   * permissions, geolocation, fullscreen, a new window, the file chooser) goes to the first one that overrides it,
   * and the core steps aside; an observation callback the core implements (page start and finish, errors, history,
   * progress, title, renderer death) reaches the core first, then every one that overrides it. Add them in `attach`.
   */
  val clients: MutableList<WebViewClient>
  val chromeClients: MutableList<WebChromeClient>

  /** Sends `onNativeEvent({ name, payload })` to JS. */
  fun emit(name: String, payload: Map<String, Any?>)

  /** Sends the event and waits for JS's answer, the handler's return value; null when the view or its page goes away. */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)
}

private val overrideCache = HashMap<String, Boolean>()
private val BASES = setOf<Class<*>>(WebViewClient::class.java, WebChromeClient::class.java, WebViewClientCompat::class.java)

/** Whether this client's class overrides the callback [name] taking [types]; the base classes' own methods don't count. */
internal fun Any.overrides(name: String, vararg types: Class<*>): Boolean =
  overrideCache.getOrPut("${javaClass.name}#$name(${types.joinToString { it.name }})") {
    javaClass.getMethod(name, *types).declaringClass !in BASES
  }
