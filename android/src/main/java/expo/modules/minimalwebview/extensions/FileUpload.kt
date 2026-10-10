package expo.modules.minimalwebview.extensions

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * `<input type="file">`: asks the app's `onFileRequest` for URIs (null = cancel). Without a handler, opens the system
 * chooser (FileChooserParams.createIntent; no camera capture). Built only on the extension interface.
 */
class FileUpload : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var hasHandler = false

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
    hasHandler = config["hasHandler"] == true
  }

  override fun onShowFileChooser(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    if (!hasHandler) {
      val launched = host.launchForResult(params.createIntent()) { resultCode, data ->
        callback.onReceiveValue(FileChooserParams.parseResult(resultCode, data))
      }
      if (!launched) callback.onReceiveValue(null)
      return true
    }
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
