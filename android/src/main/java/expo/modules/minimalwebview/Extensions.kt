package expo.modules.minimalwebview

import android.app.Activity
import android.content.Intent
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

  /** Checks only; never prompts. */
  fun hasPermission(permission: String): Boolean

  /** Starts an activity for a result (e.g. the system file chooser); false when there is no activity. */
  fun launchForResult(intent: Intent, onResult: (resultCode: Int, data: Intent?) -> Unit): Boolean
}

/** Pending activity results by request code, delivered from the module's OnActivityResult. */
object ActivityResults {
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

/** Third-party packages call `WebViewExtensions.register("name") { MyExtension() }` from their module's OnCreate. */
object WebViewExtensions {
  private val factories = mutableMapOf<String, () -> WebViewExtension>()

  fun register(name: String, factory: () -> WebViewExtension) {
    factories[name] = factory
  }

  fun create(name: String): WebViewExtension? = factories[name]?.invoke()
}
