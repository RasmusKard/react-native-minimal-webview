package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.MinimalWebViewModule

/**
 * `<input type="file">`: asks the app's `onFileRequest` for URIs (null = cancel). The app picks them, with
 * expo-document-picker or expo-image-picker. Without the prop the core opens the system chooser.
 */
internal class FileUpload(private val owner: MinimalWebView) {
  // The page's open file chooser (WebView allows one at a time). Chromium releases it only while its document is alive,
  // so a navigation away cancels it when it starts, not at commit; a later answer is dropped.
  private var held: ValueCallback<Array<Uri>>? = null

  /** Wraps the file chooser's [callback] so it is answered once: by whoever takes the request, or by [cancel]. */
  fun hold(callback: ValueCallback<Array<Uri>>): ValueCallback<Array<Uri>> =
    object : ValueCallback<Array<Uri>> {
      override fun onReceiveValue(value: Array<Uri>?) {
        if (held !== this) return
        held = null
        callback.onReceiveValue(value)
      }
    }.also { held = it }

  fun cancel() = held?.onReceiveValue(null)

  /** The app's prop, else the system chooser (its intent ignores `capture`). [callback] is answered once. */
  fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams) {
    if ("fileRequest" !in owner.requestHandlers) {
      val module = owner.appContext.registry.getModule<MinimalWebViewModule>()
      if (module == null) callback.onReceiveValue(null) else module.openFileChooser(params.createIntent(), callback::onReceiveValue)
      return
    }
    val request = mapOf(
      "accept" to params.acceptTypes.filter { it.isNotEmpty() },
      "multiple" to (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE),
      "capture" to params.isCaptureEnabled
    )
    owner.asks.ask("core.fileRequest", request) { answer ->
      val uris = (answer as? List<*>)?.mapNotNull { (it as? String)?.let(Uri::parse) }
      callback.onReceiveValue(uris?.toTypedArray())
    }
  }
}
