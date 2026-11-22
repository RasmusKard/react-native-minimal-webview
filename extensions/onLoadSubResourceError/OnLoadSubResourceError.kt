package expo.modules.minimalwebviewextensions

import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

internal object OnLoadSubResourceError {
  const val KEY = "@react-native-minimal-webview/extensions.onLoadSubResourceError"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.clients += Client(context)
  }

  private class Client(private val context: WebViewContext) : WebViewClient() {
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (request.isForMainFrame) return
      val event = mapOf("url" to request.url.toString(), "code" to error.errorCode, "description" to error.description.toString())
      context.emit("error", event)
    }
  }
}
