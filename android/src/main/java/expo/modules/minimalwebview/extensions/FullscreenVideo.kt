package expo.modules.minimalwebview.extensions

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient.CustomViewCallback
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * HTML5 fullscreen video: the page's fullscreen view covers the WebView's own window (so it also works inside an RN
 * Modal) on a black backdrop, system bars hide, and back exits. Orientation is the app's: it can unlock it in the
 * `fullscreen` event (expo-screen-orientation).
 */
class FullscreenVideo : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var shown: Pair<View, CustomViewCallback>? = null
  private var backdrop: FrameLayout? = null
  private var backCallback: OnBackPressedCallback? = null

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback): Boolean {
    if (shown != null) exit()
    val window = host.webView.rootView as? ViewGroup ?: return false
    backdrop = FrameLayout(view.context).apply {
      setBackgroundColor(Color.BLACK)
      addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      window.addView(this, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    shown = view to callback
    backCallback = (host.activity as? ComponentActivity)?.let { component ->
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = exit()
      }.also { component.onBackPressedDispatcher.addCallback(it) }
    }
    controller()?.apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    host.emit("fullscreen", mapOf("active" to true))
    return true
  }

  override fun onHideCustomView(): Boolean {
    removeView()
    return true
  }

  /** Leaves fullscreen from our side: WebView then calls onHideCustomView. */
  private fun exit() {
    val callback = shown?.second ?: return
    removeView()
    callback.onCustomViewHidden()
  }

  private fun removeView() {
    if (shown == null) return
    shown = null
    backdrop?.let { (it.parent as? ViewGroup)?.removeView(it) }
    backdrop?.removeAllViews()
    backdrop = null
    controller()?.show(WindowInsetsCompat.Type.systemBars())
    backCallback?.remove()
    backCallback = null
    host.emit("fullscreen", mapOf("active" to false))
  }

  private fun controller() = host.activity?.window?.let { WindowCompat.getInsetsController(it, it.decorView) }

  override fun onDetach() = exit()
}
