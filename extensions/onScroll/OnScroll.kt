package expo.modules.minimalwebviewextensions

import android.view.View
import expo.modules.minimalwebview.MinimalWebViewHooks

/** The hook behind the `onScroll` prop: each scroll change, as react-native-webview's event, in dp. */
internal object OnScroll {
  const val KEY = "minimal-rn-webview-extensions.onScroll"

  // The content size is View's protected scroll range: a subclass could read it too, but a hook with a webViewFactory
  // can't attach to a WebView that exists already.
  private val ranges by lazy {
    listOf("computeHorizontalScrollRange", "computeVerticalScrollRange").map {
      View::class.java.getDeclaredMethod(it).apply { isAccessible = true }
    }
  }

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.scrollListeners += View.OnScrollChangeListener { view, x, y, _, _ ->
      if (context.options != null) context.emit("scroll", event(view, x, y))
    }
    null
  }

  private fun event(view: View, x: Int, y: Int): Map<String, Any?> {
    val density = view.resources.displayMetrics.density
    val (width, height) = ranges.map { (it.invoke(view) as Int) / density }
    return mapOf(
      "contentOffset" to mapOf("x" to x / density, "y" to y / density),
      "contentInset" to mapOf("top" to 0, "left" to 0, "bottom" to 0, "right" to 0),
      "contentSize" to mapOf("width" to width, "height" to height),
      "layoutMeasurement" to mapOf("width" to view.width / density, "height" to view.height / density)
    )
  }
}
