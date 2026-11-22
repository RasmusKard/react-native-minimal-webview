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
 * The `perf` suite's probe (example/perf.ts). It only observes: `perfMark.mark(i)` from the page stamps the moment
 * before the page navigates to `…&i=<i>` (on the JavaBridge thread, synchronously), and the first main-frame
 * `shouldInterceptRequest` for that URL the moment its request starts (on Chromium's IO thread).
 * `ref.hook('sample.perf', 'drain')` hands the stamps to JS and clears them.
 */
internal object PerfProbe {
  fun register() {
    MinimalWebViewHooks.register("sample.perf") { webView, context ->
      val probe = Probe()
      webView.addJavascriptInterface(probe, "perfMark")
      context.clients += probe.client
      context.handle("drain") { _, reply -> reply(probe.drain()) }
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

private fun now() = SystemClock.elapsedRealtimeNanos().toDouble()

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
