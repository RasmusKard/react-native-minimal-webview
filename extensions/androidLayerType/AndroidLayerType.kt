package expo.modules.minimalwebviewextensions

import android.view.View
import expo.modules.minimalwebview.MinimalWebViewHooks

/** The hook behind the `androidLayerType` prop; its value is the layer type's name. */
internal object AndroidLayerType {
  const val KEY = "@minimal-rn-webview/extensions.androidLayerType"
  private val TYPES = mapOf("software" to View.LAYER_TYPE_SOFTWARE, "hardware" to View.LAYER_TYPE_HARDWARE)

  // Attach runs again on the WebView that replaces a crashed one, so it gets the layer type too.
  fun register() = MinimalWebViewHooks.register(KEY) { webView, context ->
    val apply = { webView.setLayerType(TYPES[context.options] ?: View.LAYER_TYPE_NONE, null) }
    apply()
    context.onOptionsChange { apply() }
    null
  }
}
