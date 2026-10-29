package expo.modules.minimalwebviewextensions

import android.view.View
import android.view.ViewGroup
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind the `nestedScrollEnabled` prop: as react-native-webview does, each touch asks the WebView's parents
 * not to intercept it, so a scrolling parent leaves the gesture to the page. The listener never consumes the touch.
 */
internal object NestedScrollEnabled {
  const val KEY = "minimal-rn-webview-extensions.nestedScrollEnabled"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.touchListeners += View.OnTouchListener { view, _ ->
      if (context.options == true) (view as ViewGroup).requestDisallowInterceptTouchEvent(true)
      false
    }
    null
  }
}
