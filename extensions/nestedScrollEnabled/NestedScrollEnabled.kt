package expo.modules.minimalwebviewextensions

import android.view.View
import android.view.ViewGroup
import expo.modules.minimalwebview.MinimalWebViewHooks

internal object NestedScrollEnabled {
  const val KEY = "@react-native-minimal-webview/extensions.nestedScrollEnabled"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.touchListeners += View.OnTouchListener { view, _ ->
      (view as ViewGroup).requestDisallowInterceptTouchEvent(true)
      false
    }
  }
}
