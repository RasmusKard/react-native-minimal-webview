package expo.modules.minimalwebview.requests

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient.CustomViewCallback
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.minimalwebview.DocumentScope.End
import expo.modules.minimalwebview.MinimalWebView

/** HTML5 fullscreen video, and the `onFullscreenChange` prop. */
internal class FullscreenVideo(private val owner: MinimalWebView) {
  private var shown: Pair<View, CustomViewCallback>? = null
  private var backdrop: FrameLayout? = null
  private var backCallback: OnBackPressedCallback? = null
  // The app's bars before fullscreen, restored on exit: an immersive app keeps its bars hidden.
  private var barsShownBefore = 0
  private var barsBehaviorBefore: Int? = null

  /** Returns false when there is no window to cover; the caller then tells WebView the view is hidden. */
  fun onShowCustomView(view: View, callback: CustomViewCallback): Boolean {
    if (shown != null) exit()
    val window = owner.webView.rootView as? ViewGroup ?: return false
    backdrop = FrameLayout(view.context).apply {
      setBackgroundColor(Color.BLACK)
      addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      window.addView(this, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    shown = view to callback
    backCallback = (owner.activity as? ComponentActivity)?.let { component ->
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = exit()
      }.also { component.onBackPressedDispatcher.addCallback(it) }
    }
    controller()?.apply {
      val insets = ViewCompat.getRootWindowInsets(owner.webView)
      barsShownBefore = listOf(WindowInsetsCompat.Type.statusBars(), WindowInsetsCompat.Type.navigationBars())
        .filter { insets?.isVisible(it) ?: true }
        .fold(0) { mask, type -> mask or type }
      barsBehaviorBefore = systemBarsBehavior
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    report(true)
    return true
  }

  fun onHideCustomView() = removeView()

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
    controller()?.apply {
      show(barsShownBefore)
      barsBehaviorBefore?.let { systemBarsBehavior = it }
    }
    backCallback?.remove()
    backCallback = null
    report(false)
  }

  private fun report(active: Boolean) {
    if ("fullscreenChange" in owner.requestHandlers) owner.emit("core.fullscreenChange", mapOf("active" to active))
  }

  private fun controller() = owner.activity?.window?.let { WindowCompat.getInsetsController(it, it.decorView) }

  /** The Document ended: its fullscreen view goes. A crash leaves no renderer to tell; at unmount WebView is told. */
  fun documentEnded(reason: End) {
    if (reason == End.CLOSING) exit() else removeView()
  }
}
