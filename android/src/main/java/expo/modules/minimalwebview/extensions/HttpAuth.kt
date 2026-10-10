package expo.modules.minimalwebview.extensions

import android.webkit.HttpAuthHandler
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * HTTP basic and digest auth: asks the app's `onHttpAuthRequest({host, realm})` for `{username, password}` or null
 * (cancel). Without the prop the core cancels.
 */
class HttpAuth : WebViewExtension {
  private lateinit var host: ExtensionHost

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onHttpAuthRequest(handler: HttpAuthHandler, host: String, realm: String): Boolean {
    if (!this.host.handles("httpAuthRequest")) return false
    this.host.ask("httpAuthRequest", mapOf("host" to host, "realm" to realm)) { answer ->
      val credential = answer as? Map<*, *>
      val user = credential?.get("username") as? String
      val password = credential?.get("password") as? String
      if (user != null && password != null) handler.proceed(user, password) else handler.cancel()
    }
    return true
  }
}
