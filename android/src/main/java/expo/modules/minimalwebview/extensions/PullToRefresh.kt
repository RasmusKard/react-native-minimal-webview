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
  // The page's answer for the current touch. It is not reset at touch-down: SwipeRefreshLayout ignores a gesture
  // whose down event saw "can scroll up", and the answer (a few ms) arrives before the finger passes the touch slop.
  private var innerScrolled = false

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun wrap(content: View): View = Layout(content.context).apply {
    addView(content)
    setOnRefreshListener { host.webView.reload() }
    setOnChildScrollUpCallback { _, _ -> host.webView.canScrollVertically(-1) || innerScrolled }
    layout = this
  }

  private fun checkInnerScroller(x: Float, y: Float) {
    val density = host.webView.resources.displayMetrics.density
    host.webView.evaluateJavascript("($INNER_SCROLLED)(${x / density}, ${y / density})") { result ->
      innerScrolled = result == "true"
    }
  }

  override fun onPageFinished(url: String) {
    layout?.isRefreshing = false
    innerScrolled = false
  }

  private inner class Layout(context: Context) : SwipeRefreshLayout(context) {
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
      if (event.actionMasked == MotionEvent.ACTION_DOWN) checkInnerScroller(event.x, event.y)
      return super.onInterceptTouchEvent(event)
    }
  }
}

/** True when the element at (x, y) has a scrolled ancestor that can scroll vertically (CSS pixels). */
private const val INNER_SCROLLED = """(x, y) => {
  for (let e = document.elementFromPoint(x, y); e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && e.scrollHeight > e.clientHeight && e.scrollTop > 0) return true;
  }
  return false;
}"""
