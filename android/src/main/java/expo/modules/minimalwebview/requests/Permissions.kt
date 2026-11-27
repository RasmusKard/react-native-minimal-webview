package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.MinimalWebView
import expo.modules.minimalwebview.defaultPorts

internal class Permissions(private val owner: MinimalWebView) {
  private val requests = Waiting<PermissionRequest>()
  private val prompts = Waiting<GeolocationPermissions.Callback>()

  /** Returns true when the app's prop takes the request; it is then granted or denied once. */
  fun onPermissionRequest(request: PermissionRequest): Boolean {
    val known = request.resources.filter { it in RESOURCES }
    return requests.decide(request, request.origin.toString(), known.map { RESOURCES.getValue(it) }, deny = request::deny) {
      request.grant(known.toTypedArray())
    }
  }

  fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    prompts.decide(callback, origin, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) {
      callback.invoke(origin, true, false)
    }

  // Chromium gave up on the request: cancel its ask, removed first so that nothing answers the request. Answering one
  // Chromium already destroyed aborts the app on WebView 133 (an invalid JNI weak reference).
  fun onPermissionRequestCanceled(request: PermissionRequest) = requests.cancel(request)

  // Not told which prompt: every geolocation ask goes, unanswered like a cancelled request.
  fun onGeolocationPromptHidden() = prompts.cancelAll()

  private inner class Waiting<K> {
    private val ids = mutableMapOf<K, Int>()

    /**
     * Asks the app, then runs [grant] or [deny]. Returns false (the caller denies) without the prop. Android reports the
     * requesting frame's origin but not the frame, so an origin other than the top-level page's is denied.
     */
    fun decide(key: K, origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit): Boolean {
      if ("onPermissionRequest" !in owner.requestHandlers) return false
      val value = originOf(origin)
      if (resources.isEmpty() || value != originOf(owner.committedUrl)) {
        deny()
        return true
      }
      val id = owner.asks.ask("core", "onPermissionRequest", mapOf("origin" to value, "resources" to resources)) { answer ->
        if (ids.remove(key) == null) return@ask
        if (answer == true) grant() else deny()
      }
      if (id != null) ids[key] = id
      return true
    }

    fun cancel(key: K) {
      ids.remove(key)?.let { owner.asks.cancel(it) }
    }

    fun cancelAll() {
      val cancelled = ids.values.toList()
      ids.clear()
      cancelled.forEach { owner.asks.cancel(it) }
    }
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
    fun origin(scheme: String?, host: String?, port: Int) =
      "$scheme://$host" + if (port == -1 || port == defaultPorts[scheme]) "" else ":$port"
  }
}
