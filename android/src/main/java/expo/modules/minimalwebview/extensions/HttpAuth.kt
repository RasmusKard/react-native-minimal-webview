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

  // Per host and realm until the next page finishes, as on iOS. Android reports no failure count, so count the asks
  // here: a handler that returns wrong credentials would otherwise get the same challenge forever. And one answer
  // after a decline: a server that offers Digest and Basic challenges again with the other scheme.
  private val asked = mutableMapOf<String, Int>()
  private val declined = mutableSetOf<String>()

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onHttpAuthRequest(handler: HttpAuthHandler, host: String, realm: String): Boolean {
    val key = "$host/$realm"
    if (!this.host.handles("httpAuthRequest") || (asked[key] ?: 0) >= MAX_ASKS) return false
    if (key in declined) return true.also { handler.cancel() }
    asked[key] = (asked[key] ?: 0) + 1
    this.host.ask("httpAuthRequest", mapOf("host" to host, "realm" to realm)) { answer ->
      val credential = answer as? Map<*, *>
      val user = credential?.get("username") as? String
      val password = credential?.get("password") as? String
      if (user != null && password != null) {
        handler.proceed(user, password)
      } else {
        declined += key
        handler.cancel()
      }
    }
    return true
  }

  override fun onPageFinished(url: String) {
    asked.clear()
    declined.clear()
  }

  private companion object {
    /** iOS's `previousFailureCount < 3`: the first answer and two retries. */
    const val MAX_ASKS = 3
  }
}
