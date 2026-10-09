package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.os.SystemClock
import android.util.Log
import java.net.URISyntaxException
import android.view.View
import android.view.ViewGroup
import android.content.pm.PackageManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.Navigation
import androidx.webkit.NavigationListener
import androidx.webkit.Page
import androidx.webkit.ScriptHandler
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

  // Declared before webView: createWebView() reads it during construction.
  private val hasNavigationListener = WebViewFeature.isFeatureSupported(WebViewFeature.NAVIGATION_LISTENER)

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
  private var installedScripts: List<Map<String, Any?>>? = null
  private val scriptHandlers = mutableListOf<ScriptHandler>()
  var userAgent: String? = null
  var applicationNameForUserAgent: String? = null
  var thirdPartyCookies = false
  var mediaPlaybackRequiresUserAction = true
  var showsScrollIndicators = true
  var webviewDebuggingEnabled = false
  /** JS handles `external` navigations (onOpenExternal); native only reports them. */
  var openExternalInJS = false
  private var loadedSource: Map<String, Any?>? = null

  // Extensions live until the `extensions` prop changes. `wrap` runs again for each new WebView.
  private var activeExtensions: Map<String, WebViewExtension>? = null
  private var installedExtensions: List<Map<String, Any?>>? = null
  // The bridge as installed (script and origins), so a changed bridge prop can replace it.
  private var installedBridge: Pair<String?, List<String>?>? = null
  private var bridgeScriptHandler: ScriptHandler? = null

  // Every `ask` (navigation and extensions) waits here for JS, by id, until answered through extensionCall.
  private val pendingAsks = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextAskId = 0

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String? = null
  private var title = ""
  private var loading = false
  private var progress = 0.0
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false

  // Bridge: the page posts through `window.nativeBridgeTransport`; replies go to the main frame's latest proxy.
  private var replyProxy: JavaScriptReplyProxy? = null
  private val crashTimes = ArrayDeque<Long>()
  // URLs an `ask` allowed in the current navigation chain: their redirects back to them are not asked again.
  private val askedAndAllowed = mutableSetOf<String>()

  init {
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun createWebView() = WebView(context).also { view ->
    configure(view.settings)
    view.webViewClient = Client()
    view.webChromeClient = ChromeClient()
    view.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
      val download = DownloadInfo(url, userAgent, contentDisposition.orEmpty(), mimeType.orEmpty(), contentLength)
      activeExtensions.orEmpty().values.any { it.onDownloadStart(download) }
    }
    if (hasNavigationListener) WebViewCompat.addNavigationListener(view, context.mainExecutor, Listener())
  }

  @SuppressLint("SetJavaScriptEnabled") // because a browser-tab WebView needs JS; no addJavascriptInterface is used
  private fun configure(settings: WebSettings) {
    settings.javaScriptEnabled = true
    // window.open and target=_blank reach onCreateWindow; the navigation rules decide (newWindow: true).
    settings.setSupportMultipleWindows(true)
    settings.javaScriptCanOpenWindowsAutomatically = true
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
    if (extensions.orEmpty() != installedExtensions) installExtensions()
    if (bridgeScript to bridgeOrigins != installedBridge) installBridge()
    installScripts()
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
    webView.isVerticalScrollBarEnabled = showsScrollIndicators
    webView.isHorizontalScrollBarEnabled = showsScrollIndicators
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, thirdPartyCookies)
    // Process-wide on Android: the last WebView to set it wins.
    WebView.setWebContentsDebuggingEnabled(webviewDebuggingEnabled)
  }

  private fun installExtensions() {
    activeExtensions?.values?.forEach { it.onDetach() }
    installedExtensions = extensions.orEmpty()
    activeExtensions = extensions.orEmpty().mapNotNull { spec ->
      val name = spec["name"] as? String ?: return@mapNotNull null
      val extension = WebViewExtensions.create(name)
      if (extension == null) Log.w(TAG, "no WebView extension registered as $name")
      @Suppress("UNCHECKED_CAST") // because config comes from JS as a plain object
      extension?.onAttach(hostFor(name), spec["config"] as? Map<String, Any?> ?: emptyMap())
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

  private fun hostFor(name: String) = object : ExtensionHost {
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

  /** The generic channel from JS: answers to any `ask`, or calls routed to an extension by name. */
  fun extensionCall(name: String, method: String, args: Map<String, Any?>): Any? {
    if (method == "__answer") {
      pendingAsks.remove((args["askId"] as? Number)?.toInt())?.invoke(args["value"])
      return null
    }
    return activeExtensions?.get(name)?.onCall(method, args)
  }

  private fun pageFinished(url: String) {
    activeExtensions?.values?.forEach { it.onPageFinished(url) }
  }

  private fun installBridge() {
    if (installedBridge != null) {
      WebViewCompat.removeWebMessageListener(webView, "nativeBridgeTransport")
      bridgeScriptHandler?.remove()
      bridgeScriptHandler = null
      replyProxy = null
    }
    installedBridge = bridgeScript to bridgeOrigins
    val script = bridgeScript ?: return
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)
    ) {
      onBridge(mapOf("unavailable" to true))
      return
    }
    val origins = bridgeOrigins.orEmpty().toSet()
    // A malformed origin rule makes WebView throw; createBridge validates them, so this only guards against misuse.
    // JS learns of it: calls reject with `unavailable`.
    val installed = try {
      addBridge(script, origins)
      true
    } catch (e: IllegalArgumentException) {
      failed("bridge not installed: invalid allowedOrigins $origins", e)
    }
    if (!installed) onBridge(mapOf("unavailable" to true))
  }

  private fun addBridge(script: String, origins: Set<String>) {
    WebViewCompat.addWebMessageListener(webView, "nativeBridgeTransport", origins) { _, message, _, isMainFrame, proxy ->
      // Main frame only, like iOS. The origin rules already filtered the sender.
      if (!isMainFrame) return@addWebMessageListener
      replyProxy = proxy
      onBridge(mapOf("message" to message.data))
    }
    val pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
    bridgeScriptHandler = WebViewCompat.addJavaScriptOnEvent(
      webView, script, WebViewCompat.INJECTION_EVENT_DOCUMENT_START, origins, pageWorld
    )
  }

  /** Changed scripts take effect from the next navigation. */
  private fun installScripts(force: Boolean = false) {
    val scripts = injectedScripts.orEmpty()
    if (!force && scripts == installedScripts) return
    installedScripts = scripts
    scriptHandlers.forEach { it.remove() }
    scriptHandlers.clear()
    if (scripts.isEmpty()) return
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)) {
      Log.w(TAG, "injectedScripts need WebView 146+; update Android System WebView")
      return
    }
    val pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
    for (script in scripts) {
      val code = script["code"] as? String ?: continue
      // No frame selector in androidx.webkit 1.17: main-frame-only scripts guard themselves.
      // A prefix, not a wrapping block: top-level const/let/class in the script must stay global.
      val source = if (script["mainFrameOnly"] == true) "if (window !== window.top) throw 0;\n$code" else code
      val event = if (script["when"] == "end") WebViewCompat.INJECTION_EVENT_DOCUMENT_END else WebViewCompat.INJECTION_EVENT_DOCUMENT_START
      scriptHandlers += WebViewCompat.addJavaScriptOnEvent(webView, source, event, setOf("*"), pageWorld)
    }
  }

  fun bridgePost(message: String) {
    replyProxy?.postMessage(message)
  }

  /** Returns true to cancel the navigation (shouldOverrideUrlLoading's meaning). */
  private fun decide(request: NavigationRules.Request): Boolean {
    val decision = NavigationRules.decide(navigationRules, request)
    if (decision.action == "ask" && request.url in askedAndAllowed) {
      notifyNavigation(request, "allow", decision.rule)
      return false
    }
    // An external link that cannot be opened is reported as blocked.
    val action = when (decision.action) {
      "ask" -> return true.also { ask(request, decision.rule) }
      "external" -> if (openExternal(request.url)) "external" else "block"
      else -> decision.action
    }
    notifyNavigation(request, action, decision.rule)
    return action != "allow"
  }

  private fun fields(request: NavigationRules.Request) = mapOf(
    "url" to request.url,
    "mainFrame" to request.mainFrame,
    "newWindow" to request.newWindow,
    "userInitiated" to request.userInitiated
  )

  private fun notifyNavigation(request: NavigationRules.Request, action: String, rule: Int?) =
    onNavigation(fields(request) + mapOf("action" to action, "rule" to rule))

  // Cancel now, ask JS, reissue on allow. Never blocks the UI thread. Loses the referrer and gesture flag.
  private fun ask(request: NavigationRules.Request, rule: Int?) {
    if (!request.mainFrame) {
      Log.w(TAG, "`ask` only works for main-frame navigations on Android; blocked ${request.url}")
      notifyNavigation(request, "block", rule)
      return
    }
    val id = register { answer ->
      val action = answer as? String ?: "block"
      if (action == "allow") {
        askedAndAllowed += request.url
        webView.loadUrl(request.url)
      }
      val opened = action != "external" || openExternal(request.url)
      notifyNavigation(request, if (action in ACTIONS && opened) action else "block", rule)
    }
    onNavigationRequest(fields(request) + ("id" to id))
    // Unanswered after the timeout: block (the answer callback runs with null).
    postDelayed({ pendingAsks.remove(id)?.invoke(null) }, ASK_TIMEOUT_MS)
  }

  /**
   * Opens a URL outside the WebView. Returns false when it could not be opened (the caller reports `block`): a page
   * controls the URL, so a malformed intent (bad syntax, launchFlags=zz) or a refused activity must not crash the app.
   */
  private fun openExternal(url: String): Boolean {
    if (openExternalInJS) return true
    val intent = try {
      browsableIntent(url)
    } catch (e: URISyntaxException) {
      return failed("malformed external URL $url", e)
    } catch (e: IllegalArgumentException) {
      return failed("malformed external URL $url", e)
    }
    return try {
      context.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      openFallback(intent, url, e)
    } catch (e: SecurityException) {
      failed("not allowed to open $url", e)
    }
  }

  private fun failed(message: String, error: Exception): Boolean {
    Log.w(TAG, message, error)
    return false
  }

  /** Only what a browser would allow: BROWSABLE, no explicit component or selector, and no URI permission grants. */
  private fun browsableIntent(url: String): Intent {
    val intent = if (url.startsWith("intent:", ignoreCase = true)) {
      Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
        component = null
        selector = null
      }
    } else {
      Intent(Intent.ACTION_VIEW, Uri.parse(url))
    }
    intent.addCategory(Intent.CATEGORY_BROWSABLE)
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    return intent
  }

  // No app for the link: an intent may name a web fallback, as Chrome supports. It goes through the rules like any
  // other navigation. Otherwise nothing happens.
  private fun openFallback(intent: Intent, url: String, error: ActivityNotFoundException): Boolean {
    val fallback = intent.getStringExtra("browser_fallback_url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
      ?: return failed("no app opens $url", error)
    if (!decide(NavigationRules.Request(fallback, true, false, false))) webView.loadUrl(fallback)
    return true
  }

  /** Answers every pending ask with null (block, cancel) and forgets the bridge's reply proxy. */
  private fun failPending() {
    val waiting = pendingAsks.values.toList()
    pendingAsks.clear()
    waiting.forEach { it(null) }
    replyProxy = null
    failEvaluations()
  }

  private val evaluations = mutableSetOf<Promise>()

  /** Runs a script in the page. WebView drops the callback when the document is replaced first, so a new document
   * rejects what is still waiting (as iOS does) instead of leaving the promise pending forever. */
  fun evaluate(script: String, promise: Promise) {
    evaluations += promise
    webView.evaluateJavascript(script) { if (evaluations.remove(promise)) promise.resolve(it) }
  }

  private fun failEvaluations() {
    val waiting = evaluations.toList()
    evaluations.clear()
    waiting.forEach { it.reject("navigated", "the page navigated before the script finished", null) }
  }

  /** The render process died: a WebView cannot be reused after that, so build a new one and reload. */
  private fun recover(didCrash: Boolean) {
    val now = SystemClock.elapsedRealtime()
    crashTimes.addLast(now)
    while (crashTimes.first() < now - CRASH_WINDOW_MS) crashTimes.removeFirst()
    val recovered = crashTimes.size <= MAX_CRASHES_PER_WINDOW
    val lastUrl = url.takeIf { it.isNotEmpty() }
    failPending()
    val old = webView
    webView = createWebView()
    applySettings()
    installedBridge = null
    bridgeScriptHandler = null
    installBridge()
    installScripts(force = true)
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

  private fun reportError(kind: String, url: String, code: Int, description: String) {
    onError(mapOf("kind" to kind, "url" to url, "code" to code, "description" to description, "isMainFrame" to true))
  }

  // Changes within one frame are combined into one event, except `loading` flips: a load that starts and fails
  // within one frame must still reach JS as loading true -> false (onLoadStart / onLoadEnd).
  private fun stateChanged() {
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

    // A failed main-frame load commits an error page at the failed URL: `url` becomes that URL, as on iOS.
    override fun onNavigationCompleted(navigation: Navigation) {
      if (navigation.didCommit()) url = navigation.url
      if (navigation.didCommit() && !navigation.isSameDocument) {
        askedAndAllowed.clear()
        failEvaluations()
        // A new document: the old reply proxy is gone; JS queues bridge messages until the page is ready again.
        replyProxy = null
        if (installedBridge?.first != null) onBridge(mapOf("navigated" to true))
      }
      if (!navigation.isSameDocument) {
        pendingUrl = null
        if (!navigation.didCommit()) {
          loading = false
          pageFinished(navigation.url)
        }
      }
      stateChanged()
    }

    override fun onPageLoadEvent(page: Page) {
      loading = false
      pageFinished(page.url)
      stateChanged()
    }
  }

  private inner class Client : WebViewClient() {
    // Not called for POST, the initial loadUrl, or reissued loads; called again for their redirects.
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
      decide(NavigationRules.Request(request.url.toString(), request.isForMainFrame, false, request.hasGesture()))

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
      if (hasNavigationListener) return
      loading = true
      stateChanged()
    }

    override fun onPageFinished(view: WebView, url: String?) {
      if (hasNavigationListener) return
      loading = false
      pageFinished(url ?: "")
      stateChanged()
    }

    // Best-effort URL tracking when WebView updates are disabled and NAVIGATION_LISTENER is missing.
    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
      if (hasNavigationListener) return
      this@MinimalWebView.url = url ?: return
      stateChanged()
    }

    // Main frame only: subresource failures (an ad's 404) are the page's business.
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      val description = error.description.toString()
      if (!request.isForMainFrame || description.contains("ERR_ABORTED")) return
      reportError("network", request.url.toString(), error.errorCode, description)
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
      if (!request.isForMainFrame) return
      reportError("http", request.url.toString(), response.statusCode, response.reasonPhrase.orEmpty())
    }

    @SuppressLint("WebViewClientOnReceivedSslError") // because it always cancels; it only reports the error
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, sslError: SslError) {
      handler.cancel()
      // Also called for subresources (an ad image): only the main frame's URL is a page error.
      if (sslError.url == (pendingUrl ?: url)) {
        reportError("ssl", sslError.url, sslError.primaryError, "SSL error ${sslError.primaryError}")
      }
    }

    // Basic and digest auth: an extension answers (httpAuth); without one, cancel (the page shows its 401).
    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
      if (activeExtensions.orEmpty().values.none { it.onHttpAuthRequest(handler, host, realm) }) handler.cancel()
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      // Returning true keeps the app alive; a stale WebView (already replaced) needs nothing more.
      if (view === webView) post { recover(detail.didCrash()) }
      return true
    }
  }

  private inner class ChromeClient : WebChromeClient() {
    // A throwaway WebView catches the new window's first URL; the rules decide, then it is destroyed.
    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
      val child = WebView(context)
      var done = false
      fun finish() {
        if (done) return
        done = true
        post { child.destroy() }
      }
      child.webViewClient = object : WebViewClient() {
        // A renderer crash in the throwaway window must not take the app down.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail) = true.also { finish() }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
          val target = request.url.toString()
          if (!done && !decide(NavigationRules.Request(target, true, true, isUserGesture))) webView.loadUrl(target)
          finish()
          return true
        }
      }
      // window.open('') or about:blank never navigates: give up on it.
      postDelayed(::finish, NEW_WINDOW_TIMEOUT_MS)
      (resultMsg.obj as WebView.WebViewTransport).webView = child
      resultMsg.sendToTarget()
      return true
    }

    // First extension that handles it wins; otherwise the WebView cancels the chooser.
    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams) =
      activeExtensions.orEmpty().values.any { it.onShowFileChooser(callback, params) }

    // Without an extension that handles them: deny (never grant device access by default).
    override fun onPermissionRequest(request: PermissionRequest) {
      if (activeExtensions.orEmpty().values.none { it.onPermissionRequest(request) }) request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
      if (activeExtensions.orEmpty().values.none { it.onGeolocationPrompt(origin, callback) }) callback.invoke(origin, false, false)
    }

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
      if (activeExtensions.orEmpty().values.none { it.onShowCustomView(view, callback) }) callback.onCustomViewHidden()
    }

    override fun onHideCustomView() {
      activeExtensions.orEmpty().values.any { it.onHideCustomView() }
    }

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

private const val TAG = "MinimalWebView"
private const val ASK_TIMEOUT_MS = 1000L
private const val NEW_WINDOW_TIMEOUT_MS = 5000L
private val ACTIONS = setOf("allow", "block", "external")
// ponytail: fixed crash-loop guard; make it a prop if an app needs a different policy
private const val MAX_CRASHES_PER_WINDOW = 3
private const val CRASH_WINDOW_MS = 60_000L
