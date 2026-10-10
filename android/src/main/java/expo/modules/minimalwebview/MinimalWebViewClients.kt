package expo.modules.minimalwebview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.util.Log
import android.view.View
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
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.Navigation
import androidx.webkit.NavigationListener
import androidx.webkit.Page

// WebView's callbacks. A new set is made for each WebView (recover() replaces it).

internal class Listener(private val owner: MinimalWebView, private val newDocument: () -> Unit) : NavigationListener {
  override fun onNavigationStarted(navigation: Navigation) {
    if (navigation.isSameDocument) return
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
      if (!navigation.didCommit()) {
        owner.loading = false
        owner.pageFinished(navigation.url)
      }
    }
    owner.stateChanged()
  }

  override fun onPageLoadEvent(page: Page) {
    owner.loading = false
    owner.pageFinished(page.url)
    owner.stateChanged()
  }
}

internal class Client(private val owner: MinimalWebView, private val navigation: MinimalWebViewNavigation) : WebViewClient() {
  // Not called for POST, the initial loadUrl, or reissued loads; called again for their redirects.
  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
    navigation.decide(NavigationRules.Request(request.url.toString(), request.isForMainFrame, false, request.hasGesture()))

  // Without NavigationListener (WebView older than 146): a main-frame document starts loading here.
  override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
    if (owner.hasNavigationListener) return
    owner.newDocument()
    owner.loading = true
    owner.stateChanged()
  }

  override fun onPageFinished(view: WebView, url: String?) {
    if (owner.hasNavigationListener) return
    owner.loading = false
    owner.pageFinished(url ?: "")
    owner.stateChanged()
  }

  // Best-effort URL tracking when WebView updates are disabled and NAVIGATION_LISTENER is missing.
  override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
    if (owner.hasNavigationListener) return
    owner.url = url ?: return
    owner.stateChanged()
  }

  // Main frame only: subresource failures (an ad's 404) are the page's business.
  override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
    val description = error.description.toString()
    if (!request.isForMainFrame || description.contains("ERR_ABORTED")) return
    owner.reportError("network", request.url.toString(), error.errorCode, description)
  }

  override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
    if (!request.isForMainFrame) return
    owner.reportError("http", request.url.toString(), response.statusCode, response.reasonPhrase.orEmpty())
  }

  @SuppressLint("WebViewClientOnReceivedSslError") // because it always cancels; it only reports the error
  override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, sslError: SslError) {
    handler.cancel()
    // Also called for subresources (an ad image): only the main frame's URL is a page error.
    if (sslError.url == (owner.pendingUrl ?: owner.url)) {
      owner.reportError("ssl", sslError.url, sslError.primaryError, "SSL error ${sslError.primaryError}")
    }
  }

  // Basic and digest auth: a hook answers (onHttpAuthRequest); without one, cancel (the page shows its 401).
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
    if (owner.hooks.none { it.onHttpAuthRequest(handler, host, realm) }) handler.cancel()
  }

  override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
    // Returning true keeps the app alive; a stale WebView (already replaced) needs nothing more.
    if (view === owner.webView) owner.post { owner.recover(detail.didCrash()) }
    return true
  }
}

internal class ChromeClient(private val owner: MinimalWebView, private val navigation: MinimalWebViewNavigation) : WebChromeClient() {
  override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message) =
    navigation.createWindow(isUserGesture, resultMsg)

  // The first hook that handles it wins (onFileRequest); otherwise the system chooser. Its intent ignores `capture`.
  // Returning false makes WebView cancel the chooser itself.
  override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    if (owner.hooks.any { it.onShowFileChooser(callback, params) }) return true
    val activity = owner.appContext.currentActivity ?: return false
    val code = ActivityResults.register { resultCode, data -> callback.onReceiveValue(FileChooserParams.parseResult(resultCode, data)) }
    try {
      activity.startActivityForResult(params.createIntent(), code)
    } catch (e: ActivityNotFoundException) {
      Log.w(TAG, "no activity opens the file chooser", e)
      ActivityResults.deliver(code, Activity.RESULT_CANCELED, null)
    }
    return true
  }

  // Without a hook that handles them: deny (never grant device access by default).
  override fun onPermissionRequest(request: PermissionRequest) {
    if (owner.hooks.none { it.onPermissionRequest(request) }) request.deny()
  }

  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
    if (owner.hooks.none { it.onGeolocationPrompt(origin, callback) }) callback.invoke(origin, false, false)
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    if (owner.hooks.none { it.onShowCustomView(view, callback) }) callback.onCustomViewHidden()
  }

  override fun onHideCustomView() {
    owner.hooks.any { it.onHideCustomView() }
  }

  override fun onReceivedTitle(view: WebView, title: String?) {
    owner.title = title ?: ""
    owner.stateChanged()
  }

  override fun onProgressChanged(view: WebView, newProgress: Int) {
    owner.progress = newProgress / 100.0
    owner.stateChanged()
  }
}

/** Pending activity results by request code, delivered from the module's OnActivityResult. */
internal object ActivityResults {
  private val pending = mutableMapOf<Int, (Int, Intent?) -> Unit>()
  private var nextCode = 0x4D57 // "MW": away from codes apps commonly use

  fun register(onResult: (Int, Intent?) -> Unit): Int {
    val code = nextCode++
    pending[code] = onResult
    return code
  }

  fun deliver(requestCode: Int, resultCode: Int, data: Intent?) {
    pending.remove(requestCode)?.invoke(resultCode, data)
  }
}
