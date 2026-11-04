package expo.modules.minimalwebviewextensions

import android.graphics.Color
import expo.modules.minimalwebview.MinimalWebViewHooks

/** The hook behind `transparentBackground()`: the WebView's background color is transparent, and white when it is off. */
internal object TransparentBackground {
  const val KEY = "@react-native-minimal-webview/extensions.transparentBackground"

  // White is WebView's default: it has no getter for the color it had.
  fun register() = MinimalWebViewHooks.register(KEY) { webView, context ->
    val apply = { webView.setBackgroundColor(if (context.options != null) Color.TRANSPARENT else Color.WHITE) }
    apply()
    context.onOptionsChange { apply() }
  }
}
