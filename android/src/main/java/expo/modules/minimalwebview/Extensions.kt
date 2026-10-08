package expo.modules.minimalwebview

import android.net.Uri
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebView

/**
 * A per-instance WebView extension. EXPERIMENTAL until the built-ins and one out-of-package extension use it.
 * Every hook has a no-op default. Enable one on a WebView with the `extensions` prop.
 */
interface WebViewExtension {
  fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {}

  /** Container hook: return a view that holds [content] (the WebView), or [content] itself. */
  fun wrap(content: View): View = content

  fun onPageFinished(url: String) {}

  /** Return true to handle the chooser; the callback must then be called exactly once (null = cancel). */
  fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean = false

  /** A call from the extension's JS helper. */
  fun onCall(method: String, args: Map<String, Any?>): Any? = null

  fun onDetach() {}
}

interface ExtensionHost {
  val webView: WebView
  fun emit(event: String, payload: Map<String, Any?>)

  /** Async decide hook: emits [event] to the extension's JS `onEvent` and calls [onAnswer] with its result (null if the view goes away). */
  fun ask(event: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit)
}

/** Third-party packages call `WebViewExtensions.register("name") { MyExtension() }` from their module's OnCreate. */
object WebViewExtensions {
  private val factories = mutableMapOf<String, () -> WebViewExtension>()

  fun register(name: String, factory: () -> WebViewExtension) {
    factories[name] = factory
  }

  fun create(name: String): WebViewExtension? = factories[name]?.invoke()
}
