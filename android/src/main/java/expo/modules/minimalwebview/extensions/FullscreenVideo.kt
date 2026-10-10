package expo.modules.minimalwebview.extensions

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

/** HTML5 fullscreen video: the page's fullscreen view covers the activity, system bars hide, back exits. */
class FullscreenVideo : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var shown: Pair<View, CustomViewCallback>? = null
  private var backCallback: OnBackPressedCallback? = null

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback): Boolean {
    val activity = host.activity ?: return false
    if (shown != null) exit()
    val decor = activity.window.decorView as ViewGroup
    decor.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    shown = view to callback
    controller()?.apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    backCallback = (activity as? ComponentActivity)?.let { component ->
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = exit()
      }.also { component.onBackPressedDispatcher.addCallback(it) }
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
    val (view, _) = shown ?: return
    shown = null
    (view.parent as? ViewGroup)?.removeView(view)
    controller()?.show(WindowInsetsCompat.Type.systemBars())
    backCallback?.remove()
    backCallback = null
    host.emit("fullscreen", mapOf("active" to false))
  }

  private fun controller() = host.activity?.window?.let { WindowCompat.getInsetsController(it, it.decorView) }

  override fun onDetach() = exit()
}
