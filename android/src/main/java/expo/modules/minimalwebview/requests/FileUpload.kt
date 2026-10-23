package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import expo.modules.minimalwebview.MinimalWebView

/**
 * `<input type="file">`: asks the app's `onFileRequest` for URIs (null = cancel). The app picks them, with
 * expo-document-picker or expo-image-picker. Without the prop the core opens the system chooser.
 */
internal class FileUpload(private val owner: MinimalWebView) {
  /** Returns true when the app's prop takes the request; [callback] is then answered once. */
  fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    if ("fileRequest" !in owner.requestHandlers) return false
    val request = mapOf(
      "accept" to params.acceptTypes.filter { it.isNotEmpty() },
      "multiple" to (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE),
      "capture" to params.isCaptureEnabled
    )
    owner.asks.ask("core.fileRequest", request) { answer ->
      val uris = (answer as? List<*>)?.mapNotNull { (it as? String)?.let(Uri::parse) }
      callback.onReceiveValue(uris?.toTypedArray())
    }
    return true
  }
}
