package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.JavaScriptReplyProxy
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
  private val onNavigationRequest by EventDispatcher<Map<String, Any?>>()
  private val onBridge by EventDispatcher<Map<String, Any?>>()
  private val onExtension by EventDispatcher<Map<String, Any?>>()

  val webView = WebView(context)

  // Props, applied together in applyProps()
  var source: Map<String, Any?>? = null
  var navigationRules: List<Map<String, Any?>>? = null
  var bridgeScript: String? = null
  var bridgeOrigins: List<String>? = null
  var extensions: List<Map<String, Any?>>? = null
  private var activeExtensions: Map<String, WebViewExtension> = emptyMap()
  private val pendingAsks = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextAskId = 0
  private var extensionsInstalled = false
  private var loadedSource: Map<String, Any?>? = null

  // Navigation state. Native owns the committed URL; JS is told.
  private var url = ""
  private var pendingUrl: String? = null
  private var title = ""
  private var loading = false
  private var progress = 0.0
  private var lastEmitted: Map<String, Any?>? = null
  private var emitScheduled = false
  // Bridge: the page posts through `window.nativeBridgeTransport`; replies go to the main frame's latest proxy.
  private var bridgeInstalled = false
  private var replyProxy: JavaScriptReplyProxy? = null

  // `ask` decisions waiting for JS, by request id. Unanswered ones expire after ASK_TIMEOUT_MS (= block).
  private val pendingRequests = mutableMapOf<Int, String>()
  private var nextRequestId = 0
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
    installExtensions()
    installBridge()
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

  // ponytail: installed once per view, like the bridge
  private fun installExtensions() {
    if (extensionsInstalled) return
    extensionsInstalled = true
    activeExtensions = extensions.orEmpty().mapNotNull { spec ->
      val name = spec["name"] as? String ?: return@mapNotNull null
      val extension = WebViewExtensions.create(name)
      if (extension == null) Log.w(TAG, "no WebView extension registered as $name")
      @Suppress("UNCHECKED_CAST") // because config comes from JS as a plain object
      extension?.onAttach(hostFor(name), spec["config"] as? Map<String, Any?> ?: emptyMap())
      extension?.let { name to it }
    }.toMap()
    // Container hooks nest in list order: the first extension wraps the WebView, which must be detached first.
    removeView(webView)
    val content = activeExtensions.values.fold(webView as View) { view, extension -> extension.wrap(view) }
    addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun hostFor(name: String) = object : ExtensionHost {
    override val webView get() = this@MinimalWebView.webView
    override fun emit(event: String, payload: Map<String, Any?>) =
      onExtension(mapOf("name" to name, "event" to event, "payload" to payload))

    override fun ask(event: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit) {
      val id = ++nextAskId
      pendingAsks[id] = onAnswer
      onExtension(mapOf("name" to name, "event" to event, "payload" to payload, "askId" to id))
    }
  }

  /** The generic extension channel from JS: answers to `ask`, or calls routed to the extension by name. */
  fun extensionCall(name: String, method: String, args: Map<String, Any?>): Any? {
    if (method == "__answer") {
      pendingAsks.remove((args["askId"] as? Number)?.toInt())?.invoke(args["value"])
      return null
    }
    return activeExtensions[name]?.onCall(method, args)
  }

  private fun pageFinished(url: String) {
    activeExtensions.values.forEach { it.onPageFinished(url) }
  }

  // ponytail: installed once per view; changing the bridge or its origins needs a new WebView
  private fun installBridge() {
    val script = bridgeScript ?: return
    if (bridgeInstalled) return
    bridgeInstalled = true
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)
    ) {
      onBridge(mapOf("unavailable" to true))
      return
    }
    val origins = bridgeOrigins.orEmpty().toSet()
    WebViewCompat.addWebMessageListener(webView, "nativeBridgeTransport", origins) { _, message, _, isMainFrame, proxy ->
      // Main frame only, like iOS. The origin rules already filtered the sender.
      if (!isMainFrame) return@addWebMessageListener
      replyProxy = proxy
      onBridge(mapOf("message" to message.data))
    }
    val pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
    WebViewCompat.addJavaScriptOnEvent(webView, script, WebViewCompat.INJECTION_EVENT_DOCUMENT_START, origins, pageWorld)
  }

  fun bridgePost(message: String) {
    replyProxy?.postMessage(message)
  }

  /** JS answered an `ask`. Android cannot pause a navigation, so `allow` reissues it with loadUrl. */
  fun resolveNavigationRequest(id: Int, action: String) {
    val url = pendingRequests.remove(id) ?: return
    when (action) {
      "allow" -> webView.loadUrl(url)
      "external" -> openExternal(url)
    }
  }

  private fun decide(request: NavigationRules.Request): Boolean {
    val decision = NavigationRules.decide(navigationRules, request)
    when (decision.action) {
      "allow" -> return false
      "external" -> openExternal(request.url)
      "ask" -> ask(request)
    }
    return true
  }

  // Cancel now, ask JS, reissue on allow. Never blocks the UI thread. Loses the referrer and gesture flag.
  private fun ask(request: NavigationRules.Request) {
    if (!request.mainFrame) {
      Log.w(TAG, "`ask` only works for main-frame navigations on Android; blocked ${request.url}")
      return
    }
    val id = ++nextRequestId
    pendingRequests[id] = request.url
    onNavigationRequest(
      mapOf(
        "id" to id,
        "url" to request.url,
        "mainFrame" to request.mainFrame,
        "newWindow" to request.newWindow,
        "userInitiated" to request.userInitiated
      )
    )
    postDelayed({ pendingRequests.remove(id) }, ASK_TIMEOUT_MS)
  }

  private fun openExternal(url: String) {
    val intent = if (url.startsWith("intent:", ignoreCase = true)) {
      // Only what a browser would allow: no explicit component or selector.
      Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
        component = null
        selector = null
      }
    } else {
      Intent(Intent.ACTION_VIEW, Uri.parse(url))
    }
    try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
      Log.w(TAG, "no app opens $url", e)
    }
  }

  fun destroy() {
    activeExtensions.values.forEach { it.onDetach() }
    pendingAsks.values.forEach { it(null) }
    pendingAsks.clear()
    pendingRequests.clear()
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
  }

  private inner class ChromeClient : WebChromeClient() {
    // First extension that handles it wins; otherwise the WebView cancels the chooser.
    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams) =
      activeExtensions.values.any { it.onShowFileChooser(callback, params) }

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
