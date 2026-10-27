package expo.modules.sampleextension

import android.os.SystemClock
import android.view.Choreographer
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The `perf` suite's probe (example/perf.ts), in its own file, apart from the extension's sample hooks. It only
 * observes: `perfMark.mark(i)` from the page stamps the moment before the page navigates to `…&i=<i>` (on the
 * JavaBridge thread, synchronously), and the first main-frame `shouldInterceptRequest` for that URL the moment its
 * request starts (on Chromium's IO thread). It returns null there, which is what the core answers without a hook (it
 * has no `shouldInterceptRequest` of its own), so the core still decides every navigation.
 * `ref.hook('sample.perf', 'drain')` hands the stamps to JS and clears them.
 */
internal object PerfProbe {
  fun register() {
    MinimalWebViewHooks.register("sample.perf") { webView, context ->
      val probe = Probe()
      webView.addJavascriptInterface(probe, "perfMark")
      context.clients += probe.client
      context.handle("drain") { _, reply -> reply(probe.drain()) }
      null
    }
  }
}

private class Probe {
  private val marks = mutableListOf<MutableMap<String, Any>>()

  @JavascriptInterface
  fun mark(i: String) {
    val at = now()
    synchronized(marks) { marks += mutableMapOf("i" to i, "markNs" to at) }
  }

  val client = object : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      if (request.isForMainFrame) {
        val at = now()
        val i = request.url.getQueryParameter("i")
        synchronized(marks) { marks.lastOrNull { it["i"] == i && "goNs" !in it }?.put("goNs", at) }
      }
      return null
    }
  }

  fun drain() = synchronized(marks) { marks.map { it.toMap() }.also { marks.clear() } }
}

/** A monotonic clock in ns, as a Double (exact below 2^53 ns, 104 days of uptime) so it crosses to JS as a number. */
private fun now() = SystemClock.elapsedRealtimeNanos().toDouble()

/**
 * Main-thread frame gaps between [start] and [stop], from Choreographer: a UI thread blocked for 300 ms shows as one
 * gap of about 300 ms.
 */
internal object Stall : Choreographer.FrameCallback {
  private var running = false
  private var last = 0L
  private val gaps = mutableListOf<Double>()

  fun start() {
    gaps.clear()
    last = 0
    if (!running) Choreographer.getInstance().postFrameCallback(this)
    running = true
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!running) return
    if (last > 0) gaps += (frameTimeNanos - last) / 1e6
    last = frameTimeNanos
    Choreographer.getInstance().postFrameCallback(this)
  }

  fun stop(): Map<String, Any> {
    running = false
    Choreographer.getInstance().removeFrameCallback(this)
    val sorted = gaps.sorted()
    return mapOf("maxGapMs" to (sorted.lastOrNull() ?: 0.0), "medianGapMs" to (sorted.getOrNull(sorted.size / 2) ?: 0.0), "frames" to gaps.size)
  }
}
