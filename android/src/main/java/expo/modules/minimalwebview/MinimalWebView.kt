package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.Navigation
import androidx.webkit.NavigationListener
import androidx.webkit.Page
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class MinimalWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onNavigationState by EventDispatcher<Map<String, Any?>>()

  val webView = WebView(context)

  // Props, applied together in applyProps()
  var source: Map<String, Any?>? = null
  var navigationRules: List<Map<String, Any?>>? = null
  var bridgeScript: String? = null
  var bridgeOrigins: List<String>? = null
  var extensions: List<Map<String, Any?>>? = null
  var injectedScripts: List<Map<String, Any?>>? = null
  var userAgent: String? = null
  var applicationNameForUserAgent: String? = null
  var thirdPartyCookiesEnabled = false
  var mediaPlaybackRequiresUserAction = true
  var showsScrollIndicators = true
  var javaScriptCanOpenWindowsAutomatically = false
  var webviewDebuggingEnabled = false
  /** JS handles `external` navigations (onOpenExternal); native only reports them. */
  var openExternalInJS = false
  private var loadedSource: Map<String, Any?>? = null

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String? = null
  private var title = ""
  private var loading = false
  private var progress = 0.0
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false
  private val hasNavigationListener = WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER)

  init {
    configure(webView.settings)
    webView.webViewClient = Client()
    webView.webChromeClient = ChromeClient()
    if (hasNavigationListener) {
      WebViewCompat.addNavigationListener(webView, context.mainExecutor, Listener())
    }
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  @SuppressLint("SetJavaScriptEnabled") // because a browser-tab WebView needs JS; no addJavascriptInterface is used
  private fun configure(settings: WebSettings) {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
  }

  /** Called once per prop batch. `source` loads last so everything else is ready first. */
  fun applyProps() {
    val next = source ?: return
    if (next == loadedSource) return
    loadedSource = next
    val uri = next["uri"] as? String
    if (uri != null) {
      webView.loadUrl(uri)
    } else {
      webView.loadDataWithBaseURL(next["baseUrl"] as? String, next["html"] as? String ?: "", "text/html", "utf-8", null)
    }
  }

  /** Settings that may change at any time; they apply from the next navigation. */
  private fun applySettings() {
    val settings = webView.settings
    settings.userAgentString = userAgent
      ?: applicationNameForUserAgent?.let { "${WebSettings.getDefaultUserAgent(context)} $it" }
    settings.mediaPlaybackRequiresUserGesture = mediaPlaybackRequiresUserAction
    settings.javaScriptCanOpenWindowsAutomatically = javaScriptCanOpenWindowsAutomatically
    webView.isVerticalScrollBarEnabled = showsScrollIndicators
    webView.isHorizontalScrollBarEnabled = showsScrollIndicators
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, thirdPartyCookiesEnabled)
    // Process-wide on Android: the last WebView to set it wins.
    WebView.setWebContentsDebuggingEnabled(webviewDebuggingEnabled)
  }

  private fun installExtensions() {
    activeExtensions = extensions.orEmpty().mapNotNull { spec ->
      val name = spec["name"] as? String ?: return@mapNotNull null
      val extension = WebViewExtensions.create(name)
      if (extension == null) Log.w(TAG, "no WebView extension registered as $name")
      @Suppress("UNCHECKED_CAST") // because config comes from JS as a plain object
      val handles = (spec["handles"] as? List<*>).orEmpty().map { it.toString() }.toSet()
      extension?.onAttach(hostFor(name, handles), spec["config"] as? Map<String, Any?> ?: emptyMap())
      extension?.let { name to it }
    }.toMap()
    mount()
  }

  /** Puts the WebView inside the extensions' containers, in list order: the first extension wraps the WebView. */
  private fun mount() {
    removeAllViews()
    (webView.parent as? ViewGroup)?.removeView(webView)
    // A wrapper's addView(view) would give the view WRAP_CONTENT, and for the WebView Chromium then resolves CSS vh to 0.
    val content = activeExtensions.orEmpty().values.fold(webView as View) { view, extension ->
      view.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
      extension.wrap(view)
    }
    addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun hostFor(name: String, handles: Set<String>) = object : ExtensionHost {
    override val webView get() = this@MinimalWebView.webView
    override val activity get() = appContext.currentActivity
    override fun handles(event: String) = event in handles

    override fun evaluate(script: String, onResult: (Result<String>) -> Unit) = this@MinimalWebView.evaluate(script, onResult)

    override fun emit(event: String, payload: Map<String, Any?>) =
      onExtension(mapOf("name" to name, "event" to event, "payload" to payload))

    override fun ask(event: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) {
      onExtension(mapOf("name" to name, "event" to event, "payload" to payload, "askId" to register(onAnswer)))
    }
  }

  private fun register(onAnswer: (Any?) -> Unit): Int {
    val id = ++nextAskId
    pendingAsks[id] = onAnswer
    return id
  }

  /** JS's answer to an `ask` (navigation or extension). */
  fun answer(askId: Int, value: Any?) {
    pendingAsks.remove(askId)?.invoke(value)
  }

  /** A new main-frame document: asks and evaluations for the old one are over, and the bridge waits for `ready`. */
  internal fun newDocument() {
    navigation.newDocument()
    scripts.newDocument()
  }

  /** The active extensions' hooks, for the clients. */
  internal val hooks get() = activeExtensions.orEmpty().values

  internal fun pageFinished(url: String) {
    activeExtensions?.values?.forEach { it.onPageFinished(url) }
  }

  /** Answers every pending ask with null (block, cancel) and forgets the bridge's reply proxy. */
  private fun failPending() {
    val waiting = pendingAsks.values.toList()
    pendingAsks.clear()
    waiting.forEach { it(null) }
    scripts.failPending()
  }

  fun bridgePost(message: String) = scripts.post(message)

  fun evaluate(script: String, onResult: (Result<String>) -> Unit) = scripts.evaluate(script, onResult)

  /** The render process died: a WebView cannot be reused after that, so build a new one and reload. */
  internal fun recover(didCrash: Boolean) {
    val now = SystemClock.elapsedRealtime()
    crashTimes.addLast(now)
    while (crashTimes.first() < now - CRASH_WINDOW_MS) crashTimes.removeFirst()
    val recovered = crashTimes.size <= MAX_CRASHES_PER_WINDOW
    val lastUrl = url.takeIf { it.isNotEmpty() }
    failPending()
    val old = webView
    webView = createWebView()
    applySettings()
    scripts.reinstall()
    mount()
    old.destroy()
    if (recovered) {
      if (lastUrl != null) webView.loadUrl(lastUrl) else source?.let(::load)
    }
    onProcessGone(mapOf("didCrash" to didCrash, "recovered" to recovered))
  }

  fun destroy() {
    webView.stopLoading()
    webView.destroy()
  }

  private fun stateChanged() {
    if (emitScheduled) return
    emitScheduled = true
    // Changes within one frame are combined into one event.
    postOnAnimation {
      emitScheduled = false
      val state = mapOf(
        "url" to url,
        "pendingUrl" to pendingUrl,
        "title" to title,
        "loading" to loading,
        "progress" to progress,
        "canGoBack" to webView.canGoBack(),
        "canGoForward" to webView.canGoForward()
      )
      if (state != lastEmitted) {
        lastEmitted = state
        onNavigationState(state)
      }
    }
  }

  private inner class Listener : NavigationListener {
    override fun onNavigationStarted(navigation: Navigation) {
      if (navigation.isSameDocument) return
      pendingUrl = navigation.url
      loading = true
      stateChanged()
    }

    override fun onNavigationRedirected(navigation: Navigation) {
      pendingUrl = navigation.url
      stateChanged()
    }

    override fun onNavigationCompleted(navigation: Navigation) {
      if (navigation.didCommit()) url = navigation.url
      if (!navigation.isSameDocument) {
        pendingUrl = null
        if (!navigation.didCommit()) loading = false
      }
      stateChanged()
    }

    override fun onPageLoadEvent(page: Page) {
      loading = false
      stateChanged()
    }
  }

  private inner class Client : WebViewClient() {
    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
      if (hasNavigationListener) return
      loading = true
      stateChanged()
    }

    override fun onPageFinished(view: WebView, url: String?) {
      if (hasNavigationListener) return
      loading = false
      stateChanged()
    }

    // Best-effort URL tracking when WebView updates are disabled and NAVIGATION_LISTENER is missing.
    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
      if (hasNavigationListener) return
      this@MinimalWebView.url = url ?: return
      stateChanged()
    }
  }

  private inner class ChromeClient : WebChromeClient() {
    override fun onReceivedTitle(view: WebView, title: String?) {
      this@MinimalWebView.title = title ?: ""
      stateChanged()
    }

    override fun onProgressChanged(view: WebView, newProgress: Int) {
      progress = newProgress / 100.0
      stateChanged()
    }
  }
}
