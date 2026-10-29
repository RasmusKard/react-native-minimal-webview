package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.minimalwebview.DocumentScope.End
import expo.modules.minimalwebview.requests.DownloadInfo
import expo.modules.minimalwebview.requests.Downloads
import expo.modules.minimalwebview.requests.FileUpload
import expo.modules.minimalwebview.requests.FullscreenVideo
import expo.modules.minimalwebview.requests.Permissions
import java.util.concurrent.CopyOnWriteArrayList

@Suppress("TooManyFunctions") // because the view is the aggregate root: it holds what has one owner (the Expo surface, the platform WebView's life, crash recovery, the Document scope, the navigation state, the hook plumbing), and a feature with state of its own gets its own class
internal class MinimalWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onNavigationState by EventDispatcher<Map<String, Any?>>()
  private val onBridge by EventDispatcher<Map<String, Any?>>()
  private val onHookEvent by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onProcessGone by EventDispatcher<Map<String, Any?>>()
  private val onNavigation by EventDispatcher<Map<String, Any?>>()

  internal val hasNavigationListener = WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER)
  private val document = DocumentScope()
  private val navigation = MinimalWebViewNavigation(this) { onNavigation(it) }
  private val scripts = MinimalWebViewScripts(this) { onBridge(it) }

  private var current: WebView? = null
  /**
   * Made at first use, the first prop batch, so that the configure hooks see `hookOptions`. Replaced after a renderer
   * crash; while [recovering] it is the destroyed one.
   */
  internal var webView: WebView
    get() = current ?: createWebView().also { current = it }
    private set(value) {
      current = value
    }

  // Props, applied together in applyProps()
  internal var source: WebViewSource? = null
  internal var navigationRules: List<Map<String, Any?>>? = null
  internal var bridgeScript: String? = null
  internal var bridgeOrigins: List<String>? = null
  /** The `hookOptions` prop: each hook's value by key. A change reaches the attached hooks (onOptionsChange). */
  internal var hookOptions: Map<String, Any?> = emptyMap()
    set(value) {
      val old = field
      field = value
      if (hookKeys != null) optionsChanged(old)
    }
  internal var injectedScripts: List<InjectedScript>? = null
  /** The `android` prop: WebSettings and WebView setters by name, applied by [PlatformSettings]. */
  internal var settings: Map<String, Any?>? = null
  internal val platformSettings = PlatformSettings { PlatformSettings.targets(webView, it) }
  internal var pullToRefresh = false
  private val refresher = PullToRefresh(this)
  /**
   * The page requests JS has a prop for (`fileRequest`, `download`, `navigationRequest`, ...), read when a request comes.
   */
  internal var requestHandlers: Set<String> = emptySet()
  private var loadedSource: WebViewSource? = null

  // The hooks' clients. Copy-on-write: Chromium reads them on its IO thread (shouldInterceptRequest) while attach and
  // detach write them.
  val clients: MutableList<WebViewClient> = CopyOnWriteArrayList()
  val chromeClients = mutableListOf<WebChromeClient>()
  val touchListeners = mutableListOf<View.OnTouchListener>()
  val scrollListeners = mutableListOf<View.OnScrollChangeListener>()
  val activity: Activity? get() = appContext.currentActivity
  internal val fileUpload = FileUpload(this)
  internal val fullscreen = FullscreenVideo(this)
  internal val permissions = Permissions(this)
  private val downloads = Downloads(this)
  /** The enabled `hookOptions` keys the first WebView was made with, and those attached later: they pick the hooks, also for one after a crash. */
  private var hookKeys: Set<String>? = null
  /** The hooks' contexts for the current WebView, in attach order. */
  private var hookContexts: List<HookContext> = emptyList()
  /** What the attach hooks returned, run before their WebView goes away. */
  private var detachers: List<() -> Unit> = emptyList()
  private var mounted = false

  internal val asks = Asks { onHookEvent(it) }
  internal val deciders = Deciders { message -> mainHandler.post { warn(message) } }

  // Navigation state: native owns it and tells JS. The clients (MinimalWebViewClients.kt) write it.
  internal var url = ""
  internal var pendingUrl: String? = null
  internal var title = ""
  internal var loading = false
  internal var progress = 0.0
  /** How the current load ends so far, "finished", "failed" or "cancelled"; JS sees it only once `loading` is false. */
  internal var outcome: String? = null
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false

  /** From a render process death until [recover] builds the new WebView: whether it loads, and the dead one's history. */
  private var pendingRecovery: Recovery? = null
  private class Recovery(val reload: Boolean, val history: Bundle?)
  private var destroyed = false

  // The core's deferred work. Not View.post: a detached view (unmounted, or a covered screen) holds that until it is
  // attached again.
  internal val mainHandler = Handler(Looper.getMainLooper())

  init {
    // The WebView goes into the layout in setUp(); the prop only turns the pull on and off.
    addView(refresher.layout, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // What belongs to the Document (DocumentScope), reset in this order at every end. The asks last: their callbacks
    // are hook and Chromium code, and a throw there must not skip the core's own resets. The asks and the hooks skip
    // the commit that opens a Document with none open: what a hook starts in attach belongs to the Document it opens.
    document.register { fileUpload.cancel() }
    document.register { navigation.documentEnded() }
    document.register { scripts.documentEnded(it) }
    document.register { fullscreen.documentEnded(it) }
    document.register(skipsOpening = true) { asks.documentEnded(it) }
    // The hooks' own handlers, per attach: the scope has no unregister, and a crash attaches the hooks again.
    document.register(skipsOpening = true) { reason -> hookContexts.forEach { it.documentEnded(reason) } }
  }

  private fun createWebView(): WebView {
    val first = hookKeys == null
    val keys = hookKeys ?: hookOptions.filterValues(::enables).keys.also { hookKeys = it }
    val (attaching, unregistered) = selectHooks(MinimalWebViewHooks.hooks, keys)
    val (maker, unused) = pickFactory(attaching)
    val view = maker?.webViewFactory?.invoke(context) ?: WebView(context)
    hookContexts = attaching.map { HookContext(it, this) }
    // A typo, or a hook's module not linked or not rebuilt. Once: the WebView after a crash has the same keys.
    if (first) unregistered.forEach { warn("hookOptions.$it: no hook is registered under this key") }
    if (first) unused.forEach { warn("hookOptions.$it: its webViewFactory is not used, ${maker?.key}'s is") }
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
    // View's slots hold one listener each: the hooks share them through their lists.
    view.setOnTouchListener { v, event -> touchListeners.any { it.onTouch(v, event) } }
    view.setOnScrollChangeListener { v, x, y, oldX, oldY -> scrollListeners.forEach { it.onScrollChange(v, x, y, oldX, oldY) } }
    if (hasNavigationListener) WebViewCompat.addNavigationListener(view, context.mainExecutor, Listener(this))
    return view
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
    // Back and forward restore the page instead of reloading it, as WebKit does. `android.settings` applies after this.
    // Not without NavigationListener: WebView 133 sends onPageStarted for a restored page but no onPageFinished.
    if (hasNavigationListener && WebViewFeature.isFeatureSupported(WebViewFeature.BACK_FORWARD_CACHE)) {
      WebSettingsCompat.setBackForwardCacheEnabled(settings, true)
    }
    // No favicon requests: nothing shows them. attachHooks turns them back on for a hook that takes onReceivedIcon.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOWNLOAD_FAVICONS_ENABLED)) {
      WebSettingsCompat.setDownloadFaviconsEnabled(settings, false)
    }
  }

  /** Called once per prop batch. `source` loads last so everything else is ready first. */
  internal fun applyProps() {
    // The dead WebView after a crash takes nothing: recover() applies the props to the new one.
    if (recovering) return
    // The first prop batch sets up the first WebView: the hooks get their options with it.
    if (mounted) {
      applySettings()
      scripts.update()
    } else {
      setUp()
    }
    refresher.layout.isEnabled = pullToRefresh
    loadNewSource()
  }

  /** Loads `source` if it isn't the one loaded yet; returns whether it did. */
  private fun loadNewSource(): Boolean {
    val next = source ?: return false
    if (next == loadedSource) return false
    loadedSource = next
    load(next)
    return true
  }

  /** Readies a new WebView, the first or the one after a crash, in one order: settings, layout, hooks, scripts. */
  private fun setUp() {
    mounted = true
    applySettings(force = true)
    // addView(view) alone would give the view WRAP_CONTENT, and Chromium then resolves CSS vh to 0.
    refresher.content.addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // React Native ignores requestLayout: a WebView added after it laid this view out (a crash) needs its own pass.
    if (isLaidOut) measureAndLayout()
    attachHooks()
    scripts.install()
  }

  private fun load(source: WebViewSource) {
    if (source.uri == null) {
      webView.loadDataWithBaseURL(source.baseUrl, source.html ?: "", "text/html", "utf-8", null)
    } else if (source.body != null) {
      webView.postUrl(source.uri, source.body.toByteArray()) // form-urlencoded; postUrl takes no headers
    } else {
      webView.loadUrl(source.uri, source.headers.orEmpty())
    }
  }

  /** Loads the page on screen again: the `source` when that is the page (its headers, html or POST), else its URL. */
  private fun loadAgain() {
    if (showsSource(source, url)) source?.let(::load) else if (url.isNotEmpty()) webView.loadUrl(url)
  }

  /**
   * The ref's reload: the app's retry starts the crash-loop guard over. Only this clears it: the guard counts the
   * process's renderer deaths, so another view's new source or pull-to-refresh mustn't end a crash loop's count.
   */
  internal fun retry() {
    crashTimes.clear()
    reload()
  }

  internal fun reload() {
    when {
      // The renderer died and the new WebView isn't built yet: build it now, and load.
      pendingRecovery != null -> recover(reload = true)
      // Nothing loaded: the crash-loop guard gave up (processGone), and this is the app's retry.
      webView.url == null -> loadAgain()
      // WebView's reload declines a POST's form resubmission: send the source again.
      source?.body != null && showsSource(source, url) -> source?.let(::load)
      else -> webView.reload()
    }
  }

  /**
   * The `android` settings, applied from each prop batch (only the keys that changed) and all again to a new WebView
   * after a crash. A key that can't be applied is reported to JS, which warns.
   */
  private fun applySettings(force: Boolean = false) {
    platformSettings.apply(settings, force).forEach { warn("android.${it["key"]}: ${it["reason"]}") }
  }

  /** A warning for the app's developer, which JS logs with console.warn. */
  internal fun warn(message: String) = emit("core.warning", mapOf("message" to message))

  private fun attachHooks() {
    detachers = hookContexts.mapNotNull { it.hook.attach(webView, it) }
    enableFavicons()
  }

  private fun enableFavicons() {
    if (chromeClients.any { it.overrides("onReceivedIcon", WebView::class.java, Bitmap::class.java) } &&
      WebViewFeature.isFeatureSupported(WebViewFeature.DOWNLOAD_FAVICONS_ENABLED)
    ) {
      WebSettingsCompat.setDownloadFaviconsEnabled(webView.settings, true)
    }
  }

  /** Returns the contexts it detached: their onDestroyed handlers run once the WebView is destroyed. */
  private fun detachHooks(): List<HookContext> {
    val detached = hookContexts
    detachers.forEach { it() }
    detachers = emptyList()
    hookContexts.forEach { it.detach() }
    hookContexts = emptyList()
    clients.clear()
    chromeClients.clear()
    touchListeners.clear()
    scrollListeners.clear()
    return detached
  }

  /** Tells each attached hook whose value changed, and attaches a hook without `configure` or `webViewFactory` whose key turns on. */
  private fun optionsChanged(old: Map<String, Any?>) {
    for (key in old.keys + hookOptions.keys) {
      val value = hookOptions[key]
      if (old[key] == value) continue
      val context = hookContexts.find { it.key == key }
      if (context != null) {
        context.optionsChanged(value)
      } else if (addedLate(key, old[key], value, hookKeys.orEmpty())) {
        attachLate(key)
      }
    }
  }

  private fun attachLate(key: String) {
    val hook = MinimalWebViewHooks.hooks.find { it.key == key }
    lateAttachWarning(key, hook)?.let { return warn(it) }
    hookKeys = hookKeys.orEmpty() + key
    // The WebView the recovery builds attaches it with the others.
    if (recovering || hook == null) return
    val context = HookContext(hook, this)
    hookContexts = hookContexts + context
    hook.attach(webView, context)?.let { detachers = detachers + it }
    enableFavicons()
  }

  /** The handler a hook registered with `context.handle` for [method], if it is attached. */
  internal fun hookHandler(key: String, method: String) = hookContexts.find { it.key == key }?.handlers?.get(method)

  fun emit(name: String, payload: Map<String, Any?>) = onHookEvent(mapOf("name" to name, "payload" to payload))

  internal fun newDocument() = document.end(End.COMMITTED)

  internal fun pageFinished() = refresher.pageFinished()

  internal fun bridgePost(message: String) = scripts.post(message)

  internal fun evaluate(script: String, onResult: (Result<String>) -> Unit) =
    if (recovering) onResult(Result.failure(EvaluateError("unavailable", RECOVERING))) else scripts.evaluate(script, onResult)

  /**
   * The render process died. The WebView can't be reused: it goes now, after saving its history. The new one is built
   * at once if the view can be seen, else once it can (Android's guidance: not in the background).
   */
  internal fun processGone(didCrash: Boolean, at: Long) {
    if (destroyed) return
    val reload = crashAllowsReload(crashTimes, at) && !(source?.body != null && showsSource(source, url))
    document.end(End.CRASHED)
    val detached = detachHooks()
    val dead = webView
    // The source page reloads as the source: a restored entry carries neither source.headers nor an html source.
    val restorable = !showsSource(source, url)
    val history = Bundle().takeIf { reload && restorable && dead.saveState(it) != null }
    refresher.content.removeView(dead)
    dead.destroy()
    detached.forEach { it.destroyed(End.CRASHED) }
    pendingRecovery = Recovery(reload, history)
    // Nothing will end the load the crash cut off. `url` stays: loadAgain() loads it.
    if (loading) outcome = "failed"
    loading = false
    pendingUrl = null
    progress = 0.0
    refresher.pageFinished()
    onProcessGone(mapOf("didCrash" to didCrash, "recovered" to reload))
    if (canRecover()) recover() else waiting += this
    stateChanged() // after onProcessGone: the cut-off load ends as failed
  }

  private fun canRecover() = isAttachedToWindow && !inBackground

  /** The renderer died and the new WebView isn't built yet: the one in [webView] is destroyed. */
  internal val recovering get() = pendingRecovery != null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (canRecover()) recover()
  }

  /**
   * Builds the WebView that replaces the dead one and brings its history back, or else loads its page again. With
   * [reload] (the app's retry) it loads also when the crash-loop guard or a POST source held the reload back.
   */
  private fun recover(reload: Boolean = false) {
    val recovery = pendingRecovery ?: return
    pendingRecovery = null
    waiting -= this
    webView = createWebView()
    setUp()
    refresher.layout.isEnabled = pullToRefresh
    // A source the app set while this waited loads instead of the old page.
    if (!loadNewSource()) {
      val restored = recovery.history?.let { webView.restoreState(it) } != null
      if (!restored && (recovery.reload || reload)) loadAgain()
    }
    stateChanged()
  }

  internal fun destroy() {
    destroyed = true
    pendingRecovery = null
    waiting -= this
    document.end(End.CLOSING)
    val detached = detachHooks()
    downloads.detach()
    webView.stopLoading()
    webView.destroy()
    // shortcut: still in the layout here, unlike after a crash; if ProfileStore.deleteProfile in onDestroyed throws
    // "in use" on a device, remove the WebView from refresher.content before destroy() first.
    detached.forEach { it.destroyed(End.CLOSING) }
  }

  internal fun reportError(kind: String, url: String, code: Int, description: String) {
    // A network or SSL error fails the load in progress; one with no load JS saw start (an SSL error before 146) doesn't.
    if (kind != "http" && loading) outcome = "failed"
    onError(mapOf("kind" to kind, "url" to url, "code" to code, "description" to description))
  }

  // Changes within one frame are combined into one event, except `loading` flips: a load that starts and fails
  // within one frame must still reach JS as loading true -> false (onLoadStart / onLoadEnd).
  internal fun stateChanged() {
    if (loading != lastEmitted?.get("loading")) return emitState()
    if (emitScheduled) return
    emitScheduled = true
    mainHandler.postDelayed({
      emitScheduled = false
      emitState()
    }, FRAME_MS)
  }

  private fun emitState() {
    if (destroyed) return
    val state = mapOf(
      "url" to url,
      "pendingUrl" to pendingUrl,
      "title" to title,
      "loading" to loading,
      "progress" to progress,
      "canGoBack" to webView.canGoBack(),
      "canGoForward" to webView.canGoForward(),
      "outcome" to if (loading) null else outcome
    )
    if (state == lastEmitted) return
    lastEmitted = state
    onNavigationState(state)
  }

  internal companion object {
    // The app's WebViews share one renderer, so the crash-loop guard counts its deaths for the whole process.
    private val crashTimes = ArrayDeque<Long>()
    /** The views whose renderer died while they couldn't be seen. */
    private val waiting = mutableSetOf<MinimalWebView>()

    /** Whether the app is in the background (the module observes it); coming back recovers the waiting views. */
    var inBackground = false
      set(value) {
        field = value
        waiting.filter { it.canRecover() }.forEach { it.recover() }
      }
  }
}

internal const val TAG = "MinimalWebView"
internal const val RECOVERING = "the WebView is being rebuilt after its renderer died"

/** Whether this process has made a WebView, so WebView is started. */
@Volatile internal var webViewCreated = false

/** What `setWebContentsDebuggingEnabled` set; null until it is called. */
@Volatile internal var webContentsDebugging: Boolean? = null

internal fun failed(message: String, error: Exception): Boolean {
  Log.w(TAG, message, error)
  return false
}

/**
 * Whether the committed [url] is the [source]'s page (or nothing has committed yet). An html source's page is its
 * baseUrl or about:blank. Chromium canonicalizes (`https://example.com` commits as `https://example.com/`).
 */
internal fun showsSource(source: WebViewSource?, url: String): Boolean {
  if (source == null) return false
  if (url.isEmpty()) return true
  val page = source.uri ?: source.baseUrl ?: "about:blank"
  return page.trimEnd('/') == url.trimEnd('/')
}

/**
 * Records a render process death at [now] in [times] and says whether to reload after it: not after more than
 * [MAX_CRASHES_PER_WINDOW] in [CRASH_WINDOW_MS]. Every WebView on the renderer hears of its death, so one within
 * [SAME_CRASH_MS] of the last is that same death.
 */
internal fun crashAllowsReload(times: ArrayDeque<Long>, now: Long): Boolean {
  if (times.isEmpty() || now - times.last() > SAME_CRASH_MS) times.addLast(now)
  while (times.first() < now - CRASH_WINDOW_MS) times.removeFirst()
  return times.size <= MAX_CRASHES_PER_WINDOW
}

// ponytail: fixed crash-loop guard; make it a prop if an app needs a different policy
private const val MAX_CRASHES_PER_WINDOW = 3
private const val CRASH_WINDOW_MS = 60_000L
private const val SAME_CRASH_MS = 100L
private const val FRAME_MS = 16L
