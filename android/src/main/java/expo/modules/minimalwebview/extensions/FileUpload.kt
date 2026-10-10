package expo.modules.minimalwebview.extensions

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * `<input type="file">`: asks the app's `onFileRequest` for URIs (null = cancel). The app picks them, with
 * expo-document-picker or expo-image-picker. Without the prop the core opens the system chooser.
 */
class FileUpload : WebViewExtension {
  private lateinit var host: ExtensionHost

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    if (!host.handles("fileRequest")) return false
    val request = mapOf(
      "accept" to params.acceptTypes.filter { it.isNotEmpty() },
      "multiple" to (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE),
      "capture" to params.isCaptureEnabled
    )
    host.ask("fileRequest", request) { answer ->
      val uris = (answer as? List<*>)?.mapNotNull { (it as? String)?.let(Uri::parse) }
      callback.onReceiveValue(uris?.toTypedArray())
    }
    return true
  }
}
