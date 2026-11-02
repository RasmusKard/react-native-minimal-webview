package expo.modules.sampleextension

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import expo.modules.minimalwebview.DocumentScope
import expo.modules.minimalwebview.MinimalWebViewHooks

/** `sample.seams`: the context's seams other than clients, one small use of each. */
internal object Seams {
  /** How many of its WebViews were destroyed at unmount. */
  var closed = 0
    private set

  fun register() = MinimalWebViewHooks.register("sample.seams") { webView, context ->
    context.onDestroyed { reason -> if (reason == DocumentScope.End.CLOSING) closed++ }
    // Takes http(s) downloads and passes the rest (blob:, data:) on to the core.
    context.onDownloadStart { url, _, _, _, _ ->
      url.startsWith("http").also { taken -> if (taken) context.emit("download", emptyMap()) }
    }
    // Two listeners on each shared slot: the second touch listener still gets what the first doesn't consume.
    var touches = 0
    context.touchListeners += View.OnTouchListener { _, _ -> false }
    context.touchListeners += View.OnTouchListener { _, _ ->
      touches++
      false
    }
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
