package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.view.KeyEvent
import android.view.View
import android.webkit.ClientCertRequest
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.Navigation
import androidx.webkit.NavigationListener
import androidx.webkit.Page

// WebView's callbacks. A new set is made for each WebView (recover() replaces it). Each callback goes to the core, to
// the hooks' clients, or both, by the rule in WebViewContext: a decision callback to the first client that overrides it
// (else the core, or WebView's default), an observation callback to the core and then to every client that overrides it.

internal class Listener(private val owner: MinimalWebView, private val newDocument: () -> Unit) : NavigationListener {
  /** Pages that fired their load event and are still alive (current or in the back-forward cache). */
  private val loadedPages = mutableSetOf<Page>()

  override fun onPageDeleted(page: Page) {
    loadedPages -= page
  }

  override fun onNavigationStarted(navigation: Navigation) {
    if (navigation.isSameDocument) return
    owner.cancelFileChooser()
    owner.pendingUrl = navigation.url
    owner.loading = true
    owner.stateChanged()
  }

  override fun onNavigationRedirected(navigation: Navigation) {
    owner.pendingUrl = navigation.url
    owner.stateChanged()
  }

  // A failed main-frame load commits an error page at the failed URL: `url` becomes that URL, as on iOS.
  override fun onNavigationCompleted(navigation: Navigation) {
    if (navigation.didCommit()) owner.url = navigation.url
    if (navigation.didCommit() && !navigation.isSameDocument) newDocument()
    if (!navigation.isSameDocument) {
      owner.pendingUrl = null
      // A page restored from the back-forward cache (its Page, already loaded) gets no onPageLoadEvent again.
      if (!navigation.didCommit() || navigation.page in loadedPages) {
        owner.loading = false
        owner.pageFinished()
      }
    }
    owner.stateChanged()
  }

  override fun onPageLoadEvent(page: Page) {
    loadedPages += page
    owner.loading = false
    owner.pageFinished()
    owner.stateChanged()
  }
}

private val WEB_VIEW = WebView::class.java
private val STRING = String::class.java
private val INT = Integer.TYPE
private val BOOLEAN = java.lang.Boolean.TYPE
private val FLOAT = java.lang.Float.TYPE

internal class Client(private val owner: MinimalWebView, private val navigation: MinimalWebViewNavigation) : WebViewClient() {
  /** The first hook client that overrides a decision callback, or null: the core decides. */
  private fun deciding(name: String, vararg types: Class<*>) = owner.clients.firstOrNull { it.overrides(name, *types) }

  /** Every hook client that overrides an observation callback, after the core. */
  private inline fun observing(name: String, vararg types: Class<*>, block: (WebViewClient) -> Unit) =
    owner.clients.toList().forEach { if (it.overrides(name, *types)) block(it) }

  // Without NavigationListener: the last main-frame URL allowed to load (a page's navigation or a redirect), which
  // onReceivedSslError can't otherwise tell from a subresource.
  private var allowedMainFrameUrl: String? = null

  // Not called for POST, the initial loadUrl, or reissued loads; called again for their redirects.
  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    val url = request.url.toString()
    val override = deciding("shouldOverrideUrlLoading", WEB_VIEW, WebResourceRequest::class.java)?.shouldOverrideUrlLoading(view, request)
      ?: navigation.decide(NavigationRules.Request(url, request.isForMainFrame, false, request.hasGesture(), request.isRedirect))
    if (!override && request.isForMainFrame) allowedMainFrameUrl = url
    return override
  }

  // Without NavigationListener (WebView older than 146): a main-frame document starts loading here.
  // shortcut: ends the Document at load start, so a main-frame load that never commits (a download, a cancel) ends it
  // too; drop when WebView 146 is the floor
  override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
    if (!owner.hasNavigationListener) {
      owner.newDocument()
      owner.loading = true
      owner.stateChanged()
    }
    observing("onPageStarted", WEB_VIEW, STRING, Bitmap::class.java) { it.onPageStarted(view, url, favicon) }
  }

  override fun onPageFinished(view: WebView, url: String?) {
    if (!owner.hasNavigationListener) {
      owner.loading = false
      owner.pageFinished()
      owner.stateChanged()
    }
    observing("onPageFinished", WEB_VIEW, STRING) { it.onPageFinished(view, url) }
  }

  override fun onLoadResource(view: WebView, url: String?) =
    observing("onLoadResource", WEB_VIEW, STRING) { it.onLoadResource(view, url) }

  override fun onPageCommitVisible(view: WebView, url: String?) =
    observing("onPageCommitVisible", WEB_VIEW, STRING) { it.onPageCommitVisible(view, url) }

  // On a background thread, as WebView calls it: a hook client that overrides it runs there too.
  override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
    deciding("shouldInterceptRequest", WEB_VIEW, WebResourceRequest::class.java)?.shouldInterceptRequest(view, request)

  // Main frame only: subresource failures (an ad's 404) are the page's business.
  override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
    val description = error.description.toString()
    if (request.isForMainFrame && !description.contains("ERR_ABORTED")) {
      owner.reportError("network", request.url.toString(), error.errorCode, description)
    }
    observing("onReceivedError", WEB_VIEW, WebResourceRequest::class.java, WebResourceError::class.java) { it.onReceivedError(view, request, error) }
  }

  override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
    if (request.isForMainFrame) owner.reportError("http", request.url.toString(), response.statusCode, response.reasonPhrase.orEmpty())
    observing("onReceivedHttpError", WEB_VIEW, WebResourceRequest::class.java, WebResourceResponse::class.java) { it.onReceivedHttpError(view, request, response) }
  }

  override fun onFormResubmission(view: WebView, dontResend: Message, resend: Message) {
    val hook = deciding("onFormResubmission", WEB_VIEW, Message::class.java, Message::class.java)
    if (hook != null) hook.onFormResubmission(view, dontResend, resend) else super.onFormResubmission(view, dontResend, resend)
  }

  // Best-effort URL tracking when WebView updates are disabled and NAVIGATION_LISTENER is missing.
  override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
    if (!owner.hasNavigationListener && url != null) {
      owner.url = url
      owner.stateChanged()
    }
    observing("doUpdateVisitedHistory", WEB_VIEW, STRING, BOOLEAN) { it.doUpdateVisitedHistory(view, url, isReload) }
  }

  @SuppressLint("WebViewClientOnReceivedSslError") // because the core always cancels; it only reports the error
  override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, sslError: SslError) {
    val hook = deciding("onReceivedSslError", WEB_VIEW, SslErrorHandler::class.java, SslError::class.java)
    if (hook != null) return hook.onReceivedSslError(view, handler, sslError)
    handler.cancel()
    // Also called for subresources (an ad image): only the main frame's URL is a page error. Without NavigationListener
    // there's no pendingUrl: view.url shows a loadUrl in progress (back/forward stays unreported).
    val mainFrame = if (owner.hasNavigationListener) setOf(owner.pendingUrl ?: owner.url) else setOf(view.url, allowedMainFrameUrl)
    if (sslError.url in mainFrame) {
      owner.reportError("ssl", sslError.url, sslError.primaryError, "SSL error ${sslError.primaryError}")
    }
  }

  override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
    val hook = deciding("onReceivedClientCertRequest", WEB_VIEW, ClientCertRequest::class.java)
    if (hook != null) hook.onReceivedClientCertRequest(view, request) else super.onReceivedClientCertRequest(view, request)
  }

  // Basic and digest auth: a hook client, else cancel (the page shows its 401).
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
    val hook = deciding("onReceivedHttpAuthRequest", WEB_VIEW, HttpAuthHandler::class.java, STRING, STRING)
    if (hook != null) hook.onReceivedHttpAuthRequest(view, handler, host, realm) else handler.cancel()
  }

  override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean =
    deciding("shouldOverrideKeyEvent", WEB_VIEW, KeyEvent::class.java)?.shouldOverrideKeyEvent(view, event)
      ?: super.shouldOverrideKeyEvent(view, event)

  override fun onUnhandledKeyEvent(view: WebView, event: KeyEvent) {
    super.onUnhandledKeyEvent(view, event)
    observing("onUnhandledKeyEvent", WEB_VIEW, KeyEvent::class.java) { it.onUnhandledKeyEvent(view, event) }
  }

  override fun onScaleChanged(view: WebView, oldScale: Float, newScale: Float) =
    observing("onScaleChanged", WEB_VIEW, FLOAT, FLOAT) { it.onScaleChanged(view, oldScale, newScale) }

  override fun onReceivedLoginRequest(view: WebView, realm: String, account: String?, args: String?) =
    observing("onReceivedLoginRequest", WEB_VIEW, STRING, STRING, STRING) { it.onReceivedLoginRequest(view, realm, account, args) }

  override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
    // Returning true keeps the app alive; a stale WebView (already replaced) needs nothing more.
    if (view === owner.webView) owner.mainHandler.post { owner.recover(detail.didCrash()) }
    observing("onRenderProcessGone", WEB_VIEW, RenderProcessGoneDetail::class.java) { it.onRenderProcessGone(view, detail) }
    return true
  }

  override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int, callback: SafeBrowsingResponse) {
    val hook = deciding("onSafeBrowsingHit", WEB_VIEW, WebResourceRequest::class.java, INT, SafeBrowsingResponse::class.java)
    if (hook != null) hook.onSafeBrowsingHit(view, request, threatType, callback) else super.onSafeBrowsingHit(view, request, threatType, callback)
  }
}

internal class ChromeClient(private val owner: MinimalWebView, private val navigation: MinimalWebViewNavigation) : WebChromeClient() {
  private fun deciding(name: String, vararg types: Class<*>) = owner.chromeClients.firstOrNull { it.overrides(name, *types) }

  private inline fun observing(name: String, vararg types: Class<*>, block: (WebChromeClient) -> Unit) =
    owner.chromeClients.toList().forEach { if (it.overrides(name, *types)) block(it) }

  override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean =
    deciding("onCreateWindow", WEB_VIEW, BOOLEAN, BOOLEAN, Message::class.java)?.onCreateWindow(view, isDialog, isUserGesture, resultMsg)
      ?: navigation.createWindow(isUserGesture, resultMsg)

  // A hook client, else the app's prop (onFileRequest), else the system chooser (its intent ignores `capture`).
  override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    val once = owner.holdFileChooser(callback)
    deciding("onShowFileChooser", WEB_VIEW, ValueCallback::class.java, FileChooserParams::class.java)?.let {
      return it.onShowFileChooser(view, once, params)
    }
    if (owner.fileUpload.onShowFileChooser(once, params)) return true
    val module = owner.appContext.registry.getModule<MinimalWebViewModule>()
    if (module == null) once.onReceiveValue(null) else module.openFileChooser(params.createIntent(), once::onReceiveValue)
    return true
  }

  // Without a hook client or the app's prop: deny (never grant device access by default).
  override fun onPermissionRequest(request: PermissionRequest) {
    val hook = deciding("onPermissionRequest", PermissionRequest::class.java)
    when {
      hook != null -> hook.onPermissionRequest(request)
      !owner.permissions.onPermissionRequest(request) -> request.deny()
    }
  }

  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
    val hook = deciding("onGeolocationPermissionsShowPrompt", STRING, GeolocationPermissions.Callback::class.java)
    when {
      hook != null -> hook.onGeolocationPermissionsShowPrompt(origin, callback)
      !owner.permissions.onGeolocationPrompt(origin, callback) -> callback.invoke(origin, false, false)
    }
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    val hook = deciding("onShowCustomView", View::class.java, CustomViewCallback::class.java)
    when {
      hook != null -> hook.onShowCustomView(view, callback)
      !owner.fullscreen.onShowCustomView(view, callback) -> callback.onCustomViewHidden()
    }
  }

  override fun onHideCustomView() {
    val hook = deciding("onHideCustomView")
    if (hook != null) hook.onHideCustomView() else owner.fullscreen.onHideCustomView()
  }

  override fun onReceivedTitle(view: WebView, title: String?) {
    owner.title = title ?: ""
    owner.stateChanged()
    observing("onReceivedTitle", WEB_VIEW, STRING) { it.onReceivedTitle(view, title) }
  }

  override fun onProgressChanged(view: WebView, newProgress: Int) {
    owner.progress = newProgress / 100.0
    owner.stateChanged()
    observing("onProgressChanged", WEB_VIEW, INT) { it.onProgressChanged(view, newProgress) }
  }

  override fun onReceivedIcon(view: WebView, icon: Bitmap?) =
    observing("onReceivedIcon", WEB_VIEW, Bitmap::class.java) { it.onReceivedIcon(view, icon) }

  override fun onReceivedTouchIconUrl(view: WebView, url: String?, precomposed: Boolean) =
    observing("onReceivedTouchIconUrl", WEB_VIEW, STRING, BOOLEAN) { it.onReceivedTouchIconUrl(view, url, precomposed) }

  override fun onRequestFocus(view: WebView) {
    super.onRequestFocus(view)
    observing("onRequestFocus", WEB_VIEW) { it.onRequestFocus(view) }
  }

  override fun onCloseWindow(window: WebView?) {
    super.onCloseWindow(window)
    observing("onCloseWindow", WEB_VIEW) { it.onCloseWindow(window) }
  }

  override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean =
    deciding("onJsAlert", WEB_VIEW, STRING, STRING, JsResult::class.java)?.onJsAlert(view, url, message, result)
      ?: super.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean =
    deciding("onJsConfirm", WEB_VIEW, STRING, STRING, JsResult::class.java)?.onJsConfirm(view, url, message, result)
      ?: super.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean =
    deciding("onJsPrompt", WEB_VIEW, STRING, STRING, STRING, JsPromptResult::class.java)?.onJsPrompt(view, url, message, defaultValue, result)
      ?: super.onJsPrompt(view, url, message, defaultValue, result)

  override fun onJsBeforeUnload(view: WebView, url: String?, message: String?, result: JsResult): Boolean =
    deciding("onJsBeforeUnload", WEB_VIEW, STRING, STRING, JsResult::class.java)?.onJsBeforeUnload(view, url, message, result)
      ?: super.onJsBeforeUnload(view, url, message, result)

  override fun onGeolocationPermissionsHidePrompt() {
    super.onGeolocationPermissionsHidePrompt()
    observing("onGeolocationPermissionsHidePrompt") { it.onGeolocationPermissionsHidePrompt() }
  }

  override fun onPermissionRequestCanceled(request: PermissionRequest) {
    super.onPermissionRequestCanceled(request)
    observing("onPermissionRequestCanceled", PermissionRequest::class.java) { it.onPermissionRequestCanceled(request) }
  }

  override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean =
    deciding("onConsoleMessage", ConsoleMessage::class.java)?.onConsoleMessage(consoleMessage)
      ?: super.onConsoleMessage(consoleMessage)

  override fun getDefaultVideoPoster(): Bitmap? =
    deciding("getDefaultVideoPoster")?.defaultVideoPoster ?: super.getDefaultVideoPoster()

  override fun getVideoLoadingProgressView(): View? =
    deciding("getVideoLoadingProgressView")?.videoLoadingProgressView ?: super.getVideoLoadingProgressView()

  override fun getVisitedHistory(callback: ValueCallback<Array<String>>) {
    val hook = deciding("getVisitedHistory", ValueCallback::class.java)
    if (hook != null) hook.getVisitedHistory(callback) else super.getVisitedHistory(callback)
  }
}
