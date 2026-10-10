package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.minimalwebview.extensions.Downloads
import expo.modules.minimalwebview.extensions.FileUpload
import expo.modules.minimalwebview.extensions.FullscreenVideo
import expo.modules.minimalwebview.extensions.HttpAuth
import expo.modules.minimalwebview.extensions.Permissions

class MinimalWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onNavigationState by EventDispatcher<Map<String, Any?>>()
  private val onBridge by EventDispatcher<Map<String, Any?>>()
  private val onExtension by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onProcessGone by EventDispatcher<Map<String, Any?>>()
  private val onNavigation by EventDispatcher<Map<String, Any?>>()

  // Declared before webView: createWebView() reads them during construction.
  internal val hasNavigationListener = WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER)
  private val coreHost = hostFor("core") { event -> event in requestHandlers }
  private val navigation = MinimalWebViewNavigation(this, coreHost) { onNavigation(it) }
  private val scripts = MinimalWebViewScripts(this) { onBridge(it) }

  /** Replaced when the render process dies; extensions read it through their host on every use. */
  var webView = createWebView()
    private set

  // Props, applied together in applyProps()
  var source: WebViewSource? = null
  var navigationRules: List<Map<String, Any?>>? = null
  var bridgeScript: String? = null
  var bridgeOrigins: List<String>? = null
  var extensions: List<ExtensionSpec>? = null
  var injectedScripts: List<InjectedScript>? = null
  var userAgent: String? = null
  var applicationNameForUserAgent: String? = null
  var thirdPartyCookies = false
  var mediaPlaybackRequiresUserAction = true
  var showsScrollIndicators = true
  var javaScriptCanOpenWindowsAutomatically = false
  var webviewDebuggingEnabled = false
  /**
   * The page requests JS has a prop for (`fileRequest`, `download`, `navigationRequest`, ...), read when a request comes.
   * `openExternal` is there when JS handles `external` navigations (onOpenExternal); native only reports them.
   */
  var requestHandlers: Set<String> = emptySet()
  private var loadedSource: WebViewSource? = null

  // Installed once, from the first props: JS fixes `extensions` at mount. `wrap` runs again for each new WebView.
  private var activeExtensions: Map<String, WebViewExtension>? = null

  // The page requests, answered by the core on every view. After the extensions, so an extension that handles the same
  // callback comes first. They ask JS only for the requests in requestHandlers.
  private val core = listOf(FileUpload(), FullscreenVideo(), Permissions(), Downloads(), HttpAuth()).onEach {
    it.onAttach(coreHost, emptyMap())
  }

  // Every `ask` (navigation request and extensions) waits here, by id, until answered through `answer` or failed with null by a
  // new document, a crash or destroy.
  private val pendingAsks = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextAskId = 0

  // The page's open file chooser (WebView allows one at a time). Chromium releases it only while its document is alive,
  // so a navigation away cancels it when it starts, not at commit; a later answer is dropped.
  private var fileChooser: ValueCallback<Array<Uri>>? = null

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
      if (hooks.none { it.onDownloadStart(download) }) navigation.openDownload(url)
    }
    if (hasNavigationListener) WebViewCompat.addNavigationListener(view, context.mainExecutor, Listener(this, ::newDocument))
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

  private fun load(source: WebViewSource) {
    if (source.uri != null) {
      webView.loadUrl(source.uri, source.headers.orEmpty())
    } else {
      webView.loadDataWithBaseURL(source.baseUrl, source.html ?: "", "text/html", "utf-8", null)
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
      val name = spec.name ?: return@mapNotNull null
      val extension = WebViewExtensions.create(name)
      if (extension == null) Log.w(TAG, "no WebView extension registered as $name")
      val handles = spec.handles.orEmpty().toSet()
      extension?.onAttach(hostFor(name) { it in handles }, spec.config.orEmpty())
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

  private fun hostFor(name: String, handled: (String) -> Boolean): ExtensionHost = object : ExtensionHost {
    override val webView get() = this@MinimalWebView.webView
    override val activity get() = appContext.currentActivity
    override fun handles(event: String) = handled(event)

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

  /** JS's answer to an `ask`. */
  fun answer(askId: Int, value: Any?) {
    pendingAsks.remove(askId)?.invoke(value)
  }

  /** Wraps the file chooser's [callback] so it is answered once: by its handler, or by [cancelFileChooser]. */
  internal fun holdFileChooser(callback: ValueCallback<Array<Uri>>): ValueCallback<Array<Uri>> =
    object : ValueCallback<Array<Uri>> {
      override fun onReceiveValue(value: Array<Uri>?) {
        if (fileChooser !== this) return
        fileChooser = null
        callback.onReceiveValue(value)
      }
    }.also { fileChooser = it }

  internal fun cancelFileChooser() = fileChooser?.onReceiveValue(null)

  /** A new main-frame document: asks and evaluations for the old one are over, and the bridge waits for `ready`. */
  internal fun newDocument() {
    // A page request (permission, HTTP auth) or navigation `ask` belongs to the document that made it. An HTTP auth
    // challenge holds its own page's response, so that page can't commit while it waits.
    // ponytail: without NavigationListener the chooser is cancelled only here, at commit; enough on WebView 133, which
    // keeps the frame. Cancel in load/reload/shouldOverrideUrlLoading too if an older WebView stays blocked.
    cancelFileChooser()
    failAsks()
    navigation.newDocument()
    scripts.newDocument()
  }

  /** The extensions' hooks, then the core's, for the clients. */
  internal val hooks get() = activeExtensions.orEmpty().values + core

  internal fun pageFinished(url: String) {
    hooks.forEach { it.onPageFinished(url) }
  }

  /** Answers every pending ask with null (block, cancel). */
  private fun failAsks() {
    val waiting = pendingAsks.values.toList()
    pendingAsks.clear()
    waiting.forEach { it(null) }
  }

  /** Answers every pending ask with null and forgets the bridge's reply proxy. */
  private fun failPending() {
    cancelFileChooser()
    failAsks()
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
    // An html source's page has no URL to fetch (`url` is its baseUrl or about:blank): load the source again, as on iOS.
    // Chromium reports the baseUrl canonicalized (`https://example.com` commits as `https://example.com/`).
    val htmlUrl = source?.takeIf { it.html != null }?.let { it.baseUrl ?: "about:blank" }?.trimEnd('/')
    val lastUrl = url.takeIf { it.isNotEmpty() && it.trimEnd('/') != htmlUrl }
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
    hooks.forEach { it.onDetach() }
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
