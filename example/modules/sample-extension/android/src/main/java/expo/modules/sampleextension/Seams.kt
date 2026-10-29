package expo.modules.sampleextension

import expo.modules.minimalwebview.DocumentScope
import expo.modules.minimalwebview.MinimalWebViewHooks

/** `sample.seams`: the context's seams other than clients, one small use of each. */
internal object Seams {
  /** How many of its WebViews were destroyed at unmount. */
  var closed = 0
    private set

  fun register() = MinimalWebViewHooks.register("sample.seams") { _, context ->
    context.onDestroyed { reason -> if (reason == DocumentScope.End.CLOSING) closed++ }
    // Takes http(s) downloads and passes the rest (blob:, data:) on to the core.
    context.onDownloadStart { url, _, _, _, _ ->
      url.startsWith("http").also { taken -> if (taken) context.emit("download", emptyMap()) }
    }
    null
  }
}
