package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.content.pm.PackageManager
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class MinimalWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onNavigationState by EventDispatcher<Map<String, Any?>>()
  private val onNavigationRequest by EventDispatcher<Map<String, Any?>>()
  private val onBridge by EventDispatcher<Map<String, Any?>>()
  private val onExtension by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onProcessGone by EventDispatcher<Map<String, Any?>>()
  private val onNavigation by EventDispatcher<Map<String, Any?>>()

  // Declared before webView: createWebView() reads them during construction.
  internal val hasNavigationListener = WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER)
  private val navigation = MinimalWebViewNavigation(this, ::register, { onNavigation(it) }, { onNavigationRequest(it) })
  private val scripts = MinimalWebViewScripts(this) { onBridge(it) }

  /** Replaced when the render process dies; extensions read it through their host on every use. */
  var webView = createWebView()
    private set

  // Props, applied together in applyProps()
  var source: Map<String, Any?>? = null
  var navigationRules: List<Map<String, Any?>>? = null
  var bridgeScript: String? = null
  var bridgeOrigins: List<String>? = null
  var extensions: List<Map<String, Any?>>? = null
  var injectedScripts: List<Map<String, Any?>>? = null
  var userAgent: String? = null
  var applicationNameForUserAgent: String? = null
  var thirdPartyCookies = false
  var mediaPlaybackRequiresUserAction = true
  var showsScrollIndicators = true
  var javaScriptCanOpenWindowsAutomatically = false
  var webviewDebuggingEnabled = false
  /** JS handles `external` navigations (onOpenExternal); native only reports them. */
  var openExternalInJS = false
  private var loadedSource: Map<String, Any?>? = null

  // Installed once, from the first props: JS fixes `extensions` at mount. `wrap` runs again for each new WebView.
  private var activeExtensions: Map<String, WebViewExtension>? = null

  // Every `ask` (navigation and extensions) waits here for JS, by id, until answered through `answer`.
  private val pendingAsks = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextAskId = 0

  // Navigation state. Native owns the committed URL; JS is told. The clients (MinimalWebViewClients.kt) write it.
  internal var url = ""
  internal var pendingUrl: String? = null
  internal var title = ""
  internal var loading = false
  internal var progress = 0.0
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false

  private val crashTimes = ArrayDeque<Long>()

  init {
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun createWebView() = WebView(context).also { view ->
    configure(view.settings)
    view.webViewClient = Client(this, navigation)
    view.webChromeClient = ChromeClient(this, navigation)
    view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
      val download = DownloadInfo(url, userAgent, contentDisposition.orEmpty(), mimeType.orEmpty(), contentLength)
      activeExtensions.orEmpty().values.any { it.onDownloadStart(download) }
    }
    if (hasNavigationListener) WebViewCompat.addNavigationListener(view, context.mainExecutor, Listener(this) {
      navigation.newDocument()
      scripts.newDocument()
    })
  }

  @SuppressLint("SetJavaScriptEnabled") // because a browser-tab WebView needs JS; no addJavascriptInterface is used
  private fun configure(settings: WebSettings) {
    settings.javaScriptEnabled = true
    // A tap's window.open and target=_blank reach onCreateWindow; the navigation rules decide (newWindow: true).
    // Without a gesture only when the app opts in (javaScriptCanOpenWindowsAutomatically, in applySettings).
    settings.setSupportMultipleWindows(true)
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    // Pinch-zoom (an accessibility basic; pages opt out with a viewport meta), without the legacy +/- buttons.
    settings.builtInZoomControls = true
    settings.displayZoomControls = false
  }

  /** Called once per prop batch. `source` loads last so everything else is ready first. */
  fun applyProps() {
    applySettings()
    if (activeExtensions == null) installExtensions()
    scripts.apply()
    val next = source ?: return
    if (next == loadedSource) return
    loadedSource = next
    // New content from the app: the crash-loop guard starts over (recovery reloads don't come through here).
    crashTimes.clear()
    load(next)
  }

  private fun load(source: Map<String, Any?>) {
    val uri = source["uri"] as? String
    if (uri != null) {
      val headers = (source["headers"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value.toString() }
      webView.loadUrl(uri, headers.orEmpty())
    } else {
      webView.loadDataWithBaseURL(source["baseUrl"] as? String, source["html"] as? String ?: "", "text/html", "utf-8", null)
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
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, thirdPartyCookies)
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
    override fun hasPermission(permission: String) =
      context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    override fun launchForResult(intent: Intent, onResult: (Int, Intent?) -> Unit): Boolean {
      val activity = appContext.currentActivity ?: return false
      val code = ActivityResults.register(onResult)
      try {
        activity.startActivityForResult(intent, code)
      } catch (e: ActivityNotFoundException) {
        // Nothing can handle it: answer as a cancel, so the caller (e.g. the file chooser callback) completes.
        Log.w(TAG, "no activity for $intent", e)
        ActivityResults.deliver(code, Activity.RESULT_CANCELED, null)
      }
      return true
    }
    override fun handles(event: String) = event in handles

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

  fun evaluate(script: String, promise: Promise) = scripts.evaluate(script, promise)

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
    activeExtensions?.values?.forEach { it.onDetach() }
    failPending()
    webView.stopLoading()
    webView.destroy()
  }

  internal fun reportError(kind: String, url: String, code: Int, description: String) {
    onError(mapOf("kind" to kind, "url" to url, "code" to code, "description" to description))
  }

  // Changes within one frame are combined into one event, except `loading` flips: a load that starts and fails
  // within one frame must still reach JS as loading true -> false (onLoadStart / onLoadEnd).
  internal fun stateChanged() {
    if (loading != lastEmitted?.get("loading")) return emitState()
    if (emitScheduled) return
    emitScheduled = true
    postOnAnimation {
      emitScheduled = false
      emitState()
    }
  }

  private fun emitState() {
    val state = mapOf(
      "url" to url,
      "pendingUrl" to pendingUrl,
      "title" to title,
      "loading" to loading,
      "progress" to progress,
      "canGoBack" to webView.canGoBack(),
      "canGoForward" to webView.canGoForward()
    )
    if (state == lastEmitted) return
    lastEmitted = state
    onNavigationState(state)
  }
}

internal const val TAG = "MinimalWebView"

internal fun failed(message: String, error: Exception): Boolean {
  Log.w(TAG, message, error)
  return false
}

// ponytail: fixed crash-loop guard; make it a prop if an app needs a different policy
private const val MAX_CRASHES_PER_WINDOW = 3
private const val CRASH_WINDOW_MS = 60_000L
