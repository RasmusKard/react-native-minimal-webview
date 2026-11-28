package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.MinimalWebViewModule

internal class FileUpload(private val owner: MinimalWebView) {
  // WebView allows one file chooser at a time. Chromium releases it only while its document is alive.
  private var held: ValueCallback<Array<Uri>>? = null

  fun hold(callback: ValueCallback<Array<Uri>>): ValueCallback<Array<Uri>> =
    object : ValueCallback<Array<Uri>> {
      override fun onReceiveValue(value: Array<Uri>?) {
        if (held !== this) return
        held = null
        callback.onReceiveValue(value)
      }
    }.also { held = it }

  fun cancel() = held?.onReceiveValue(null)

  // FileChooserParams.createIntent ignores `capture`.
  fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams) {
    if ("onFileRequest" !in owner.requestHandlers) {
      val module = owner.appContext.registry.getModule<MinimalWebViewModule>()
      if (module == null) callback.onReceiveValue(null) else module.openFileChooser(params.createIntent(), callback::onReceiveValue)
      return
    }
    val request = mapOf(
      "accept" to params.acceptTypes.filter { it.isNotEmpty() },
      "multiple" to (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE),
      "capture" to params.isCaptureEnabled
    )
    owner.asks.ask("core", "onFileRequest", request) { answer ->
      val uris = (answer as? List<*>)?.mapNotNull { (it as? String)?.let(Uri::parse) }
      callback.onReceiveValue(uris?.toTypedArray())
    }
  }
}
