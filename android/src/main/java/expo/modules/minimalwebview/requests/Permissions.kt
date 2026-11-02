package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.MinimalWebView

/** The `onPermissionRequest` prop. */
internal class Permissions(private val owner: MinimalWebView) {
  // Asks waiting for JS, by their PermissionRequest or GeolocationPermissions.Callback, for the platform cancels.
  private val waiting = mutableMapOf<Any, Int>()

  /** Returns true when the app's prop takes the request; it is then granted or denied once. */
  fun onPermissionRequest(request: PermissionRequest): Boolean {
    val known = request.resources.filter { it in RESOURCES }
    return decide(request, request.origin.toString(), known.map { RESOURCES.getValue(it) }, deny = request::deny) {
      request.grant(known.toTypedArray())
    }
  }

  fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    decide(callback, origin, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) {
      callback.invoke(origin, true, false)
    }

  // Chromium gave up on the request: cancel its ask, removed first so that nothing answers the request. Answering one
  // Chromium already destroyed aborts the app on WebView 133 (an invalid JNI weak reference).
  fun onPermissionRequestCanceled(request: PermissionRequest) {
    waiting.remove(request)?.let { owner.asks.cancel(it) }
  }

  // Not told which prompt: every geolocation ask goes, unanswered like a cancelled request.
  fun onGeolocationPromptHidden() =
    waiting.keys.filterIsInstance<GeolocationPermissions.Callback>().forEach { key -> waiting.remove(key)?.let { owner.asks.cancel(it) } }

  /**
   * Asks the app, then runs [grant] or [deny]. False (the core denies) without the prop. Android reports the requesting
   * frame's origin but not the frame: one that isn't the top-level page's is denied (main frame only).
   */
  private fun decide(key: Any, origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit): Boolean {
    if ("permissionRequest" !in owner.requestHandlers) return false
    val value = originOf(origin)
    if (resources.isEmpty() || value != originOf(owner.webView.url)) {
      deny()
      return true
    }
    waiting[key] = owner.asks.ask("core.permissionRequest", mapOf("origin" to value, "resources" to resources)) { answer ->
      // Not there: Chromium cancelled the request, and it takes no answer.
      if (waiting.remove(key) == null) return@ask
      if (answer == true) grant() else deny()
    }
    return true
  }

  internal companion object {
    private val RESOURCES = mapOf(
      PermissionRequest.RESOURCE_VIDEO_CAPTURE to "camera",
      PermissionRequest.RESOURCE_AUDIO_CAPTURE to "microphone",
      PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID to "protectedMedia"
    )

    /**
     * `location.origin` form: the scheme's default port left out. A missing scheme or host prints as `null` (`data:…`
     * gives `data://null`, `""` gives `null://null`), and `file:///x` gives `file://`.
     */
    fun originOf(url: String?): String? {
      val uri = Uri.parse(url ?: return null)
      return origin(uri.scheme, uri.host, uri.port)
    }

    /** [originOf] from the scheme, host and port (-1 for none) that `Uri` parses. */
    fun origin(scheme: String?, host: String?, port: Int): String {
      val defaultPort = if (scheme == "https") 443 else 80
      return "$scheme://$host" + if (port == -1 || port == defaultPort) "" else ":$port"
    }
  }
}
