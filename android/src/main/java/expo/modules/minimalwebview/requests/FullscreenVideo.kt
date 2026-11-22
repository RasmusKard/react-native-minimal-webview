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
import expo.modules.minimalwebview.DocumentEnd
import expo.modules.minimalwebview.MinimalWebView

internal class FullscreenVideo(private val owner: MinimalWebView) {
  private var shownCallback: CustomViewCallback? = null
  private var backdrop: FrameLayout? = null
  private var backCallback: OnBackPressedCallback? = null
  private var barsShownBefore = 0
  private var barsBehaviorBefore: Int? = null

  /** Returns false when there is no window to cover; the caller then tells WebView the view is hidden. */
  fun onShowCustomView(view: View, callback: CustomViewCallback): Boolean {
    if (shownCallback != null) exit()
    val window = owner.webView.rootView as? ViewGroup ?: return false
    backdrop = FrameLayout(view.context).apply {
      setBackgroundColor(Color.BLACK)
      addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      window.addView(this, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
    shownCallback = callback
    backCallback = (owner.appContext.currentActivity as? ComponentActivity)?.let { component ->
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

  /** Leaves fullscreen from our side: WebView then calls onHideCustomView. */
  private fun exit() {
    val callback = shownCallback ?: return
    onHideCustomView()
    callback.onCustomViewHidden()
  }

  fun onHideCustomView() {
    if (shownCallback == null) return
    shownCallback = null
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
    if ("onFullscreenChange" in owner.requestHandlers) owner.emit("core", "onFullscreenChange", mapOf("active" to active))
  }

  private fun controller() = owner.appContext.currentActivity?.window?.let { WindowCompat.getInsetsController(it, it.decorView) }

  /** Only CLOSING (unmount) also tells WebView via `onCustomViewHidden`; after a crash no renderer is left to tell. */
  fun documentEnded(reason: DocumentEnd) {
    if (reason == DocumentEnd.CLOSING) exit() else onHideCustomView()
  }
}
