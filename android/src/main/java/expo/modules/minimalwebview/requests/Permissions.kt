package expo.modules.minimalwebview.requests

import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.MinimalWebView

/**
 * Camera, microphone, location and protected media (the device id DRM playback needs) for the main frame: the app's
 * `onPermissionRequest({origin, resources})` may request OS permission and answers true or false. Without the prop the
 * core denies. Never prompts by itself: a grant the OS has not allowed still fails in the page.
 */
internal class Permissions(private val owner: MinimalWebView) {
  // Asks waiting for JS, by their PermissionRequest or GeolocationPermissions.Callback, for the platform cancels.
  private val asks = mutableMapOf<Any, Int>()

  /** Returns true when the app's prop takes the request; it is then granted or denied once. */
  fun onPermissionRequest(request: PermissionRequest): Boolean {
    val wanted = request.resources.mapNotNull { RESOURCES[it]?.let { name -> it to name } }
    return decide(request, request.origin.toString(), wanted.map { it.second }, deny = request::deny) {
      request.grant(wanted.map { it.first }.toTypedArray())
    }
  }

  fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    decide(callback, origin, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) {
      callback.invoke(origin, true, false)
    }

  // Chromium gave up on the request: cancel its ask, removed first so that nothing answers the request. Answering one
  // Chromium already destroyed aborts the app on WebView 133 (an invalid JNI weak reference).
  fun onPermissionRequestCanceled(request: PermissionRequest) {
    asks.remove(request)?.let { owner.cancelAsk(it) }
  }

  // Not told which prompt: every geolocation ask goes, unanswered like a cancelled request.
  fun onGeolocationPromptHidden() =
    asks.keys.filterIsInstance<GeolocationPermissions.Callback>().forEach { key -> asks.remove(key)?.let { owner.cancelAsk(it) } }

  /**
   * Asks the app, then runs [grant] or [deny]. False (the core denies) without the prop. Android reports the requesting
   * frame's origin but not the frame: one that isn't the top-level page's is denied (main frame only).
   */
  private fun decide(key: Any, origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit): Boolean {
    if ("permissionRequest" !in owner.requestHandlers) return false
    val value = originOf(origin)
    if (resources.isEmpty() || value != originOf(owner.webView.url)) return true.also { deny() }
    asks[key] = owner.askWithId("core.permissionRequest", mapOf("origin" to value, "resources" to resources)) { answer ->
      // Not there: Chromium cancelled the request, and it takes no answer.
      if (asks.remove(key) == null) return@askWithId
      if (answer == true) grant() else deny()
    }
    return true
  }

  /** `location.origin` form: the scheme's default port left out. */
  private fun originOf(url: String?): String? {
    val uri = Uri.parse(url ?: return null)
    val defaultPort = if (uri.scheme == "https") 443 else 80
    val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
    return "${uri.scheme}://${uri.host}$port"
  }

  private companion object {
    val RESOURCES = mapOf(
      PermissionRequest.RESOURCE_VIDEO_CAPTURE to "camera",
      PermissionRequest.RESOURCE_AUDIO_CAPTURE to "microphone",
      PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID to "protectedMedia"
    )
  }
}
