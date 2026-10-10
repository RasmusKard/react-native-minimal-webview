package expo.modules.minimalwebview.extensions

import android.view.View
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/** Pull down at the top of the document to reload. Built only on the extension interface. */
class PullToRefresh : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var layout: SwipeRefreshLayout? = null

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun wrap(content: View): View = SwipeRefreshLayout(content.context).apply {
    addView(content)
    setOnRefreshListener { host.webView.reload() }
    // WebView sends no nested-scroll events, so ask it directly whether the document can scroll up.
    // ponytail: an inner scroller (overflow: auto) is invisible here; add a page-side scroll-top check if needed
    setOnChildScrollUpCallback { _, _ -> host.webView.canScrollVertically(-1) }
    layout = this
  }

  override fun onPageFinished(url: String) {
    layout?.isRefreshing = false
  }
}
