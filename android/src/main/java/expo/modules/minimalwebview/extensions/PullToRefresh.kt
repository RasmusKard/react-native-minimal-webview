package expo.modules.minimalwebview.extensions

import android.content.Context
import android.view.MotionEvent
import android.view.View
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * Pull down at the top of the page to reload. Built only on the extension interface. WebView sends no nested-scroll
 * events, so it asks the WebView whether the document can scroll up, and on touch-down asks the page whether the
 * element under the finger is inside an inner scroller (overflow: auto) that is already scrolled.
 */
class PullToRefresh : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var layout: SwipeRefreshLayout? = null
  // The page's answer for the current touch; null while it is pending, which holds the pull off. The down event itself
  // must see false: SwipeRefreshLayout only tracks a gesture whose down event it accepted.
  private var innerScrolled: Boolean? = false
  private var touches = 0

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun wrap(content: View): View = Layout(content.context).apply {
    addView(content)
    setOnRefreshListener { host.webView.reload() }
    setOnChildScrollUpCallback { _, _ -> host.webView.canScrollVertically(-1) || innerScrolled != false }
    layout = this
  }

  private fun checkInnerScroller(x: Float, y: Float) {
    val touch = ++touches
    val density = host.webView.resources.displayMetrics.density
    host.webView.evaluateJavascript("($INNER_SCROLLED)(${x / density}, ${y / density})") { result ->
      if (touch == touches) innerScrolled = result == "true"
    }
    // A busy page answers late: don't hold the pull off for longer than this.
    host.webView.postDelayed({ if (touch == touches && innerScrolled == null) innerScrolled = false }, ANSWER_TIMEOUT_MS)
  }

  override fun onPageFinished(url: String) {
    layout?.isRefreshing = false
    innerScrolled = false
  }

  private inner class Layout(context: Context) : SwipeRefreshLayout(context) {
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
      if (event.actionMasked != MotionEvent.ACTION_DOWN) return super.onInterceptTouchEvent(event)
      innerScrolled = false
      val intercepted = super.onInterceptTouchEvent(event)
      if (host.webView.canScrollVertically(-1)) {
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
