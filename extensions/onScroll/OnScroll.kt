package expo.modules.minimalwebviewextensions

import android.view.View
import expo.modules.minimalwebview.MinimalWebViewHooks

internal object OnScroll {
  const val KEY = "@react-native-minimal-webview/extensions.onScroll"

  private val ranges by lazy {
    listOf("computeHorizontalScrollRange", "computeVerticalScrollRange").map {
      View::class.java.getDeclaredMethod(it).apply { isAccessible = true }
    }
  }

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.scrollListeners += View.OnScrollChangeListener { view, x, y, _, _ ->
      context.emit("scroll", event(view, x, y))
    }
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
