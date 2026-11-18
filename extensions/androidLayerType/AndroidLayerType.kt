package expo.modules.minimalwebviewextensions

import android.view.View
import expo.modules.minimalwebview.MinimalWebViewHooks

/** The hook behind `androidLayerType()`; its value is the layer type's name. */
internal object AndroidLayerType {
  const val KEY = "@react-native-minimal-webview/extensions.androidLayerType"
  private val TYPES = mapOf("software" to View.LAYER_TYPE_SOFTWARE, "hardware" to View.LAYER_TYPE_HARDWARE)

  fun register() = MinimalWebViewHooks.register(KEY) { webView, context ->
    context.onOptions { webView.setLayerType(TYPES[it] ?: View.LAYER_TYPE_NONE, null) }
  }
}
