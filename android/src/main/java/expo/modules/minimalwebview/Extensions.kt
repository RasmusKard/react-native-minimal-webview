package expo.modules.minimalwebview

import android.app.Activity
import android.net.Uri
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebView

/**
 * A per-instance WebView extension. EXPERIMENTAL until the built-ins and one out-of-package extension use it.
 * Every hook has a no-op default. Enable one on a WebView with the `extensions` prop. For the decide hooks
 * (returning Boolean), the first extension that returns true handles the callback; it must then complete it once.
 * The core's page requests (file chooser, fullscreen, permissions, downloads, HTTP auth) come after every extension.
 */
interface WebViewExtension {
  fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {}

  /** Container hook: return a view that holds [content] (the WebView), or [content] itself. */
  fun wrap(content: View): View = content

  fun onPageFinished(url: String) {}

  /** The callback must be called exactly once (null = cancel). */
  fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean = false

  /** The request must be granted or denied. */
  fun onPermissionRequest(request: PermissionRequest): Boolean = false

  fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback): Boolean = false

  /** HTML5 fullscreen (video). [callback] tells WebView the view went away. */
  fun onShowCustomView(view: View, callback: CustomViewCallback): Boolean = false

  fun onHideCustomView(): Boolean = false

  fun onDownloadStart(download: DownloadInfo): Boolean = false

  /** HTTP basic or digest auth: call `handler.proceed(user, password)` or `handler.cancel()` exactly once. */
  fun onHttpAuthRequest(handler: HttpAuthHandler, host: String, realm: String): Boolean = false

  fun onDetach() {}
}

data class DownloadInfo(
  val url: String,
  val userAgent: String,
  val contentDisposition: String,
  val mimeType: String,
  val contentLength: Long
)

interface ExtensionHost {
  val webView: WebView
  val activity: Activity?

  fun emit(event: String, payload: Map<String, Any?>)

  /** Whether the extension's JS helper has a handler for [event] (its `on` map); without one, `ask` answers null. */
  fun handles(event: String): Boolean

  /** Async decide hook: emits [event] to its JS handler and calls [onAnswer] with the result (null if the view goes away). */
  fun ask(event: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)

  /** Runs an expression in the page's main frame and awaits it, like the `evaluate` ref method: its JSON, or an
   * [EvaluateError]. */
  fun evaluate(script: String, onResult: (Result<String>) -> Unit)
}

/** Third-party packages call `WebViewExtensions.register("name") { MyExtension() }` from their module's OnCreate. */
object WebViewExtensions {
  private val factories = mutableMapOf<String, () -> WebViewExtension>()

  fun register(name: String, factory: () -> WebViewExtension) {
    factories[name] = factory
  }

  fun create(name: String): WebViewExtension? = factories[name]?.invoke()
}
