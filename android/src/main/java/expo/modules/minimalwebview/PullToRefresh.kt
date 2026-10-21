package expo.modules.minimalwebview

import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Pull down at the top of the page to reload (the `pullToRefresh` prop): a SwipeRefreshLayout around the WebView.
 * WebView sends no nested-scroll events, so it asks the WebView whether the document can scroll up, and on touch-down
 * asks the page whether the element under the finger is inside an inner scroller (overflow: auto) that is already
 * scrolled.
 */
internal class PullToRefresh(private val owner: MinimalWebView) {
  // The page's answer for the current touch; null while it is pending, which holds the pull off. The down event itself
  // must see false: SwipeRefreshLayout only tracks a gesture whose down event it accepted.
  private var innerScrolled: Boolean? = false
  private var touches = 0

  /** Holds the WebView. SwipeRefreshLayout keeps its first child as its target for good, so a crash swaps the WebView here. */
  val content = FrameLayout(owner.context)

  /** Always around [content]; the prop sets `isEnabled`. */
  val layout: SwipeRefreshLayout = Layout(owner.context).apply {
    addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    setOnRefreshListener { owner.reload() }
    setOnChildScrollUpCallback { _, _ -> owner.webView.canScrollVertically(-1) || innerScrolled != false }
  }

  private fun checkInnerScroller(x: Float, y: Float) {
    val touch = ++touches
    val density = owner.webView.resources.displayMetrics.density
    owner.webView.evaluateJavascript("($INNER_SCROLLED)(${x / density}, ${y / density})") { result ->
      if (touch == touches) innerScrolled = result == "true"
    }
    // A busy page answers late: don't hold the pull off for longer than this.
    owner.mainHandler.postDelayed({ if (touch == touches && innerScrolled == null) innerScrolled = false }, ANSWER_TIMEOUT_MS)
  }

  /** A load ended: the spinner stops, or it would ignore the next pull. */
  fun pageFinished() {
    layout.isRefreshing = false
    innerScrolled = false
  }

  private inner class Layout(context: Context) : SwipeRefreshLayout(context) {
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
      // Off: no pull, and no question to the page on every touch.
      if (!isEnabled) return false
      if (event.actionMasked != MotionEvent.ACTION_DOWN) return super.onInterceptTouchEvent(event)
      innerScrolled = false
      val intercepted = super.onInterceptTouchEvent(event)
      if (owner.webView.canScrollVertically(-1)) {
        // A scrolled document already ruled this gesture out, whatever the page says: don't ask it. Dropping the
        // count makes a late answer or timeout from an earlier touch a no-op.
        touches++
      } else {
        innerScrolled = null
        checkInnerScroller(event.x, event.y)
      }
      return intercepted
    }
  }
}

private const val ANSWER_TIMEOUT_MS = 150L

/** True when the element at (x, y) has a scrolled ancestor that can scroll vertically (CSS pixels). */
private const val INNER_SCROLLED = """(x, y) => {
  for (let e = document.elementFromPoint(x, y); e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && e.scrollHeight > e.clientHeight && e.scrollTop > 0) return true;
  }
  return false;
}"""
