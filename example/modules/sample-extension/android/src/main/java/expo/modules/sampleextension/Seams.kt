package expo.modules.sampleextension

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import expo.modules.minimalwebview.DocumentEnd
import expo.modules.minimalwebview.MinimalWebViewHooks

internal object Seams {
  var closed = 0
    private set

  fun register() = MinimalWebViewHooks.register("sample.seams") { webView, context ->
    context.onDestroyed { reason -> if (reason == DocumentEnd.CLOSING) closed++ }
    context.onDownloadStart { url, _, _, _, _ ->
      url.startsWith("http").also { taken -> if (taken) context.emit("download", emptyMap()) }
    }
    var touches = 0
    context.touchListeners += View.OnTouchListener { _, _ -> false }
    context.touchListeners += View.OnTouchListener { _, _ ->
      touches++
      false
    }
    context.handle("twice") { args, reply -> reply((args[0] as Double) * 2) }
    context.handle("touch") { _, reply ->
      val now = SystemClock.uptimeMillis()
      for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_CANCEL)) {
        val event = MotionEvent.obtain(now, now, action, 1f, 1f, 0)
        webView.dispatchTouchEvent(event)
        event.recycle()
      }
      reply(touches)
    }
    val scrolled = mutableSetOf<String>()
    for (name in listOf("scrollA", "scrollB")) {
      context.scrollListeners += View.OnScrollChangeListener { _, _, _, _, _ ->
        if (scrolled.add(name)) context.emit(name, emptyMap())
      }
    }
  }
}
