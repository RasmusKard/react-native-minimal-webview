package expo.modules.minimalwebviewextensions

import android.webkit.HttpAuthHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

/** The hook behind `basicAuthCredential()`; its value is the credential. */
internal object BasicAuthCredential {
  const val KEY = "@react-native-minimal-webview/extensions.basicAuthCredential"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.clients += Client(context)
  }

  private class Client(private val context: WebViewContext) : WebViewClient() {
    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
      val credential = context.options as? Map<*, *>
      val user = credential?.get("username") as? String
      val password = credential?.get("password") as? String
      // False once the server rejected the credential for this request: Chromium would otherwise ask again forever.
      val usable = handler.useHttpAuthUsernamePassword()
      if (usable && user != null && password != null) handler.proceed(user, password) else handler.cancel()
    }
  }
}
