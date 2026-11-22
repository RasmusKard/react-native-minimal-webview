package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.AndroidRuntimeException
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.Profile
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.minimalwebview.requests.DownloadInfo
import expo.modules.minimalwebview.requests.Downloads
import expo.modules.minimalwebview.requests.FileUpload
import expo.modules.minimalwebview.requests.FullscreenVideo
import expo.modules.minimalwebview.requests.Permissions

@Suppress("TooManyFunctions") // because the view is the aggregate root; a feature with state of its own gets its own class
internal class MinimalWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onNavigationState by EventDispatcher<Map<String, Any?>>()
  private val onBridge by EventDispatcher<Map<String, Any?>>()
  private val onHookEvent by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onProcessGone by EventDispatcher<Map<String, Any?>>()
  private val onNavigation by EventDispatcher<Map<String, Any?>>()

  // Lazy: it loads the WebView provider, which throws without one, and createWebView() reports that.
  internal val hasNavigationListener by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER) }
  private val navigation = MinimalWebViewNavigation(this) { onNavigation(it) }
  internal val scripts = MinimalWebViewScripts(this) { onBridge(it) }

  internal lateinit var webView: WebView
    private set
  private val hasWebView get() = ::webView.isInitialized

  internal var source: WebViewSource? = null
  internal var navigationRules: List<Map<String, Any?>>? = null
  internal var bridgeScript: String? = null
  internal var bridgeOrigins: List<String>? = null
  internal var hookOptions: Map<String, Any?> = emptyMap()
    set(value) {
      val old = field
      field = value
      if (hasWebView) optionsChanged(old)
    }
  internal var injectedScripts: List<InjectedScript>? = null
  internal var settings: Map<String, Any?>? = null
  internal val platformSettings = PlatformSettings({ hasNavigationListener }) { PlatformSettings.targets(webView, it) }
  private val refresher = PullToRefresh(this)
  internal var pullToRefresh = false
    set(value) {
      field = value
      refresher.layout.isEnabled = value
    }
  /** The page requests JS has a prop for, by prop name (`onFileRequest`, `onDownload`, ...), and `onNavigation`. */
  internal var requestHandlers: Set<String> = emptySet()
  private var loadedSource: WebViewSource? = null

  val clients: List<WebViewClient> get() = routed(hookContexts) { it.clients }
  val chromeClients: List<WebChromeClient> get() = routed(hookContexts) { it.chromeClients }
  internal val fileUpload = FileUpload(this)
  internal val fullscreen = FullscreenVideo(this)
  internal val permissions = Permissions(this)
  private val downloads = Downloads(this)
  private var keysToAttach: Set<String> = emptySet()
  /** Chromium's IO thread reads it (shouldInterceptRequest). */
  @Volatile private var hookContexts: List<HookContext> = emptyList()

  internal val asks = Asks { onHookEvent(it) }
  internal val deciders = Deciders { message -> mainHandler.post { warn(message) } }

  internal var url = ""
  internal var pendingUrl: String? = null
  internal var title = ""
  internal var loading = false
  internal var progress = 0.0
  private var outcome: LoadOutcome? = null
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false

  private var pendingRecovery: Recovery? = null
  private class Recovery(val reload: Boolean, val history: Bundle?, val restorable: Boolean)
  private var pendingLoad: String? = null
  private var destroyed = false

  init {
    addView(refresher.layout, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun createWebView(first: Boolean): WebView {
    if (first) keysToAttach = hookOptions.keys
    val (attaching, unregistered) = selectHooks(MinimalWebViewHooks.hooks, keysToAttach)
    val (maker, unused) = pickFactory(attaching)
    val view = maker?.webViewFactory?.invoke(context) ?: WebView(context)
    hookContexts = attaching.map { HookContext(it, this) }
    if (first) unregistered.forEach { warn("extension $it: no hook is registered under this key") }
    if (first) unused.forEach { warn("extension $it: its webViewFactory is not used, ${maker?.key}'s is") }
    // Before the package touches the WebView: some calls (WebViewCompat.setProfile) must come first.
    hookContexts.forEach { it.hook.configure?.invoke(view, it) }
    webViewCreated = true
    val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    WebView.setWebContentsDebuggingEnabled(webContentsDebugging ?: debuggable)
    configure(view.settings)
    view.webViewClient = Client(this, navigation)
    view.webChromeClient = ChromeClient(this, navigation)
    view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
      val download = DownloadInfo(url, userAgent, contentDisposition.orEmpty(), mimeType.orEmpty())
      val taken = hookContexts.any {
        it.downloadStarted(url, userAgent, download.contentDisposition, download.mimeType, contentLength)
      }
      if (!taken && !downloads.onDownloadStart(download)) navigation.openDownload(url)
    }
    view.setOnTouchListener(::touched)
    view.setOnScrollChangeListener(::scrolled)
    if (hasNavigationListener) WebViewCompat.addNavigationListener(view, context.mainExecutor, Listener(this))
    return view
  }

  private fun touched(view: View, event: MotionEvent) =
    hookContexts.any { c -> c.routed && c.touchListeners.any { it.onTouch(view, event) } }

  private fun scrolled(view: View, x: Int, y: Int, oldX: Int, oldY: Int) {
    for (c in hookContexts) {
      if (c.routed) c.scrollListeners.forEach { it.onScrollChange(view, x, y, oldX, oldY) }
    }
  }

  @SuppressLint("SetJavaScriptEnabled") // because a browser-tab WebView needs JS; no addJavascriptInterface is used
  private fun configure(settings: WebSettings) {
    settings.javaScriptEnabled = true
    settings.setSupportMultipleWindows(true)
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.builtInZoomControls = true
    settings.displayZoomControls = false
    // Not without NavigationListener: WebView 133 sends onPageStarted for a restored page but no onPageFinished.
    if (hasNavigationListener && WebViewFeature.isFeatureSupported(WebViewFeature.BACK_FORWARD_CACHE)) {
      WebSettingsCompat.setBackForwardCacheEnabled(settings, true)
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOWNLOAD_FAVICONS_ENABLED)) {
      WebSettingsCompat.setDownloadFaviconsEnabled(settings, false)
    }
  }

  internal fun applyProps() {
    if (recovering) return
    if (hasWebView) {
      applySettings()
      scripts.update()
    } else {
      webView = try {
        createWebView(first = true)
      } catch (e: AndroidRuntimeException) { // no WebView provider: missing, disabled or updating
        return reportError("network", source?.uri.orEmpty(), WebViewClient.ERROR_UNKNOWN, "Android System WebView is unavailable: ${e.message}")
      }
      setUp()
    }
    loadNewSource()
  }

  private fun loadNewSource() {
    val next = source ?: return
    if (next == loadedSource) return
    loadedSource = next
    load(next)
  }

  private fun setUp() {
    applySettings(force = true)
    // addView(view) alone would give the view WRAP_CONTENT, and Chromium then resolves CSS vh to 0.
    refresher.content.addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // React Native ignores requestLayout: a WebView added after it laid this view out (a crash) needs its own pass.
    if (isLaidOut) measureAndLayout()
    hookContexts.forEach { it.hook.attach(webView, it) }
    scripts.install()
  }

  private fun load(source: WebViewSource) {
    if (source.uri == null) {
      webView.loadDataWithBaseURL(source.baseUrl, source.html ?: "", "text/html", "utf-8", null)
    } else if (source.body != null) {
      webView.postUrl(source.uri, source.body.toByteArray())
    } else {
      webView.loadUrl(source.uri, source.headers.orEmpty())
    }
  }

  /** The ref's `load`: like [retry], the app's own action starts the crash-loop guard over. */
  internal fun load(url: String) {
    crashTimes.clear()
    if (recovering) pendingLoad = url else webView.loadUrl(url)
  }

  private fun loadAgain() {
    if (showsSource(source, url)) source?.let(::load) else if (url.isNotEmpty()) webView.loadUrl(url)
  }

  /** The ref's reload: the app's retry starts the crash-loop guard over. */
  internal fun retry() {
    crashTimes.clear()
    reload()
  }

  internal fun reload() {
    when {
      recovering -> recover(forceLoad = true)
      !hasWebView -> applyProps()
      // A POST source: WebView's reload declines its form resubmission.
      webView.url == null || showingPost -> loadAgain()
      else -> webView.reload()
    }
  }

  private val showingPost get() = source?.body != null && showsSource(source, url)

  private fun applySettings(force: Boolean = false) {
    platformSettings.apply(settings, force).forEach { warn("android.${it["key"]}: ${it["reason"]}") }
  }

  internal fun warn(message: String) = emit("core", "warning", mapOf("message" to message))

  private fun optionsChanged(old: Map<String, Any?>) {
    for (key in inRegistrationOrder(old.keys + hookOptions.keys, MinimalWebViewHooks.hooks.map { it.key })) {
      val value = hookOptions[key]
      if (old[key] == value) continue
      val context = hookContexts.find { it.key == key }
      if (context != null) {
        context.optionsChanged(value)
      } else if (key !in keysToAttach && old[key] == null) {
        attachLate(key)
      }
    }
  }

  private fun attachLate(key: String) {
    val hook = MinimalWebViewHooks.hooks.find { it.key == key }
      ?: return warn("extension $key: no hook is registered under this key")
    hook.notLate?.let { return warn("extension $key: its hook has $it, so it attaches only when the WebView is created") }
    keysToAttach = keysToAttach + key
    if (recovering) return
    val context = HookContext(hook, this)
    hookContexts = hookContexts + context
    hook.attach(webView, context)
  }

  /** The handler a hook registered with `context.handle` for [method], if it is attached and on. */
  internal fun hookHandler(key: String, method: String) = hookContexts.find { it.key == key && it.routed }?.handlers?.get(method)

  fun emit(key: String, name: String, payload: Map<String, Any?>) =
    onHookEvent(mapOf("key" to key, "name" to name, "payload" to payload))

  private var documentOpen = false

  internal fun endDocument(reason: DocumentEnd) {
    val opening = reason == DocumentEnd.COMMITTED && !documentOpen
    documentOpen = reason == DocumentEnd.COMMITTED
    fileUpload.cancel()
    navigation.documentEnded()
    scripts.documentEnded(reason)
    fullscreen.documentEnded(reason)
    if (opening) return
    asks.documentEnded(reason)
    hookContexts.forEach { it.documentEnded(reason) }
  }

  internal fun loadStarted() {
    loading = true
    outcome = null
    stateChanged()
  }

  internal fun settleOutcome(value: LoadOutcome) {
    outcome = outcome ?: value
  }

  internal fun loadEnded() {
    loading = false
    refresher.pageFinished()
    stateChanged()
  }

  internal fun evaluate(script: String, onResult: (Result<String>) -> Unit) =
    if (recovering) onResult(Result.failure(EvaluateError("unavailable", RECOVERING))) else scripts.evaluate(script, onResult)

  internal fun processGone(cause: String, at: Long) {
    if (destroyed) return
    val reload = crashAllowsReload(crashTimes, at) && !showingPost
    // The source page reloads as the source: a restored entry carries neither source.headers nor an html source.
    val restorable = !showsSource(source, url)
    val history = Bundle().takeIf { reload && webView.saveState(it) != null }
    tearDown(DocumentEnd.CRASHED)
    pendingRecovery = Recovery(reload, history, restorable)
    if (loading) outcome = LoadOutcome.FAILED
    loading = false
    pendingUrl = null
    progress = 0.0
    refresher.pageFinished()
    onProcessGone(mapOf("cause" to cause, "recovered" to reload))
    // A detached view's window reports GONE: onWindowVisibilityChanged recovers once it is shown.
    if (windowVisibility == View.VISIBLE) recover()
    stateChanged()
  }

  internal val recovering get() = pendingRecovery != null

  // Also on attach: dispatchAttachedToWindow calls this unless the window is GONE.
  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility == View.VISIBLE) recover()
  }

  private fun recover(forceLoad: Boolean = false) {
    val recovery = pendingRecovery ?: return
    pendingRecovery = null
    webView = createWebView(first = false)
    setUp()
    val replaced = pendingLoad != null || source != null && source != loadedSource
    val restored = (replaced || recovery.restorable) && recovery.history?.let { webView.restoreState(it) } != null
    if (replaced) {
      loadNewSource()
      pendingLoad?.let(webView::loadUrl)
      pendingLoad = null
    } else if (!restored && (recovery.reload || forceLoad)) {
      loadAgain()
    }
    stateChanged()
  }

  internal fun destroy() {
    destroyed = true
    downloads.detach()
    if (!hasWebView || recovering) {
      pendingRecovery = null
      return endDocument(DocumentEnd.CLOSING)
    }
    webView.stopLoading()
    tearDown(DocumentEnd.CLOSING)
  }

  private fun tearDown(reason: DocumentEnd) {
    endDocument(reason)
    val detached = hookContexts
    detached.forEach { it.detach() }
    hookContexts = emptyList()
    refresher.content.removeView(webView)
    webView.destroy()
    detached.forEach { it.destroyed(reason) }
  }

  internal fun reportError(kind: String, url: String, code: Int, description: String) {
    if (loading) outcome = LoadOutcome.FAILED
    onError(mapOf("kind" to kind, "url" to url, "code" to code, "description" to description))
  }

  internal fun reportHttpError(url: String, statusCode: Int) =
    onError(mapOf("kind" to "http", "url" to url, "statusCode" to statusCode))

  internal fun stateChanged() {
    if (loadingFlipped) return emitState()
    if (emitScheduled) return
    emitScheduled = true
    mainHandler.postDelayed({
      emitScheduled = false
      emitState()
    }, FRAME_MS)
  }

  private val loadingFlipped get() = loading != lastEmitted?.get("loading")

  private fun emitState() {
    if (destroyed) return
    val (back, forward) = if (recovering) {
      (lastEmitted?.get("canGoBack") ?: false) to (lastEmitted?.get("canGoForward") ?: false)
    } else {
      webView.canGoBack() to webView.canGoForward()
    }
    val state = mapOf(
      "url" to url,
      "pendingUrl" to pendingUrl,
      "title" to title,
      "loading" to loading,
      "progress" to progress,
      "canGoBack" to back,
      "canGoForward" to forward,
      "outcome" to if (loading) null else outcome?.jsName
    )
    if (state == lastEmitted) return
    lastEmitted = state
    onNavigationState(state)
  }

  internal companion object {
    // The app's WebViews share one renderer, so the crash-loop guard counts its deaths for the whole process.
    private val crashTimes = ArrayDeque<Long>()
  }
}

internal const val TAG = "MinimalWebView"

internal enum class LoadOutcome(val jsName: String) { FINISHED("finished"), FAILED("failed"), CANCELLED("cancelled") }

/**
 * Not View.post: a detached view (unmounted, or a covered screen) holds that until it is attached again. Lazy: the JVM
 * tests load this file, and Handler's constructor throws there.
 */
internal val mainHandler by lazy { Handler(Looper.getMainLooper()) }
internal const val RECOVERING = "the WebView is being rebuilt after its renderer died"

@Volatile internal var webViewCreated = false

/** What `setWebContentsDebuggingEnabled` set; null until it is called. */
@Volatile internal var webContentsDebugging: Boolean? = null

internal fun failed(message: String, error: Exception): Boolean {
  Log.w(TAG, message, error)
  return false
}

/**
 * [webView]'s profile (`android.webView.profile`), or null when WebView has only the default one: then the process-wide
 * [CookieManager] and [WebStorage][android.webkit.WebStorage] are its. Only once the WebView is set up, so that it is
 * the profile the WebView ends on.
 */
internal fun profileOf(webView: WebView): Profile? =
  if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) WebViewCompat.getProfile(webView) else null

/**
 * Whether the committed [url] is the [source]'s page (or nothing has committed yet): the same [canonicalUrl] up to
 * trailing slashes. An html source's page is its baseUrl or about:blank.
 */
internal fun showsSource(source: WebViewSource?, url: String): Boolean {
  if (source == null) return false
  if (url.isEmpty()) return true
  val page = source.uri ?: source.baseUrl ?: "about:blank"
  return canonicalUrl(page).trimEnd('/') == canonicalUrl(url).trimEnd('/')
}

/**
 * [url] as Chromium commits it: the scheme and host lowercase, the scheme's default port dropped and an empty path
 * `/`; the rest as it is. A URL with no `//` authority is returned unchanged.
 */
private fun canonicalUrl(url: String): String {
  val (scheme, userinfo, host, port, rest) = urlAuthority.find(url)?.destructured ?: return url
  val lower = scheme.lowercase()
  val portPart = port.toIntOrNull()?.takeIf { it != defaultPorts[lower] }?.let { ":$it" }.orEmpty()
  return "$lower://$userinfo${host.lowercase()}$portPart${if (rest.startsWith('/')) rest else "/$rest"}"
}

private val urlAuthority = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/?#@]*@)?(\\[[^\\]/?#]*]|[^/?#:]*)(?::(\\d*))?(.*)$")

/** The special schemes' default ports (the WHATWG URL Standard's). */
internal val defaultPorts = mapOf("http" to 80, "https" to 443, "ws" to 80, "wss" to 443, "ftp" to 21)

/**
 * Records a renderer death at [now] in [times] and says whether to reload after it: not after more than
 * [MAX_CRASHES_PER_WINDOW] in [CRASH_WINDOW_MS]. Every WebView on the renderer hears of its death, so one within
 * [SAME_CRASH_MS] of the last is that same death.
 */
internal fun crashAllowsReload(times: ArrayDeque<Long>, now: Long): Boolean {
  if (times.isEmpty() || now - times.last() > SAME_CRASH_MS) times.addLast(now)
  while (times.first() < now - CRASH_WINDOW_MS) times.removeFirst()
  return times.size <= MAX_CRASHES_PER_WINDOW
}

private const val MAX_CRASHES_PER_WINDOW = 3
private const val CRASH_WINDOW_MS = 60_000L
private const val SAME_CRASH_MS = 100L
private const val FRAME_MS = 16L
