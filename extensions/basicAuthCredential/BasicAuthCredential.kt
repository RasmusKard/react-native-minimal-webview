package expo.modules.minimalwebviewextensions

import android.webkit.HttpAuthHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

/** The hook behind `basicAuthCredential()`; its value is the credential. */
internal object BasicAuthCredential {
  const val KEY = "@minimal-rn-webview/extensions.basicAuthCredential"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    val client = Client(context)
    // A listed client answers every request: listed only while it is on, so the core declines them again.
    val list = { on: Boolean ->
      context.clients.remove(client)
      if (on) context.clients.add(client)
    }
    list(true)
    context.onOptionsChange { list(it != null) }
    null
  }

  private class Client(private val context: WebViewContext) : WebViewClient() {
    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
      val credential = context.options as? Map<*, *>
      val user = credential?.get("username") as? String
      val password = credential?.get("password") as? String
      if (user != null && password != null) handler.proceed(user, password) else handler.cancel()
    }
  }
}
