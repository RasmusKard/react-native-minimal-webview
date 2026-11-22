package expo.modules.minimalwebview

import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * WebView sends no nested-scroll events, so it asks the WebView whether the document can scroll up, and on touch-down
 * asks the page whether the element under the finger is inside an inner scroller (overflow: auto or scroll) that is
 * already scrolled.
 */
internal class PullToRefresh(private val owner: MinimalWebView) {
  // The down event itself must see UNSCROLLED: SwipeRefreshLayout only tracks a gesture whose down event it accepted.
  private var innerScroller = InnerScroller.UNSCROLLED
  private var touches = 0

  /** SwipeRefreshLayout keeps its first child as its target for good, so a crash swaps the WebView here. */
  val content = FrameLayout(owner.context)

  val layout: SwipeRefreshLayout = Layout(owner.context).apply {
    isEnabled = false
    addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    setOnRefreshListener { owner.reload() }
    setOnChildScrollUpCallback { _, _ -> owner.webView.canScrollVertically(-1) || innerScroller != InnerScroller.UNSCROLLED }
  }

  private fun checkInnerScroller(x: Float, y: Float) {
    val touch = ++touches
    val density = owner.webView.resources.displayMetrics.density
    owner.webView.evaluateJavascript("($INNER_SCROLLED)(${x / density}, ${y / density})") { result ->
      if (touch == touches) innerScroller = if (result == "true") InnerScroller.SCROLLED else InnerScroller.UNSCROLLED
    }
    mainHandler.postDelayed({ if (touch == touches && innerScroller == InnerScroller.ASKING) innerScroller = InnerScroller.UNSCROLLED }, ANSWER_TIMEOUT_MS)
  }

  /** A load ended: the spinner stops, or it would ignore the next pull. */
  fun pageFinished() {
    layout.isRefreshing = false
    innerScroller = InnerScroller.UNSCROLLED
  }

  private inner class Layout(context: Context) : SwipeRefreshLayout(context) {
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
      if (!isEnabled) return false
      if (event.actionMasked != MotionEvent.ACTION_DOWN) return super.onInterceptTouchEvent(event)
      innerScroller = InnerScroller.UNSCROLLED
      val intercepted = super.onInterceptTouchEvent(event)
      if (owner.webView.canScrollVertically(-1)) {
        touches++
      } else {
        innerScroller = InnerScroller.ASKING
        checkInnerScroller(event.x, event.y)
      }
      return intercepted
    }
  }
}

private enum class InnerScroller { UNSCROLLED, SCROLLED, ASKING }

private const val ANSWER_TIMEOUT_MS = 150L

/** True when the element at (x, y) has a scrolled ancestor that can scroll vertically (CSS pixels). */
private const val INNER_SCROLLED = """(x, y) => {
  for (let e = document.elementFromPoint(x, y); e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && e.scrollHeight > e.clientHeight && e.scrollTop > 0) return true;
  }
  return false;
}"""
