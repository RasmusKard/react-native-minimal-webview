package expo.modules.minimalwebview.extensions

import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * Camera, microphone and location for the main frame: the app's `onPermissionRequest({origin, resources})` may request
 * OS permission and answers true or false. Without the prop the core denies. Never prompts by itself: a grant the OS has
 * not allowed still fails in the page.
 */
class Permissions : WebViewExtension {
  private lateinit var host: ExtensionHost

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onPermissionRequest(request: PermissionRequest): Boolean {
    val wanted = request.resources.mapNotNull { RESOURCES[it]?.let { name -> it to name } }
    return decide(request.origin.toString(), wanted.map { it.second }, deny = request::deny) {
      request.grant(wanted.map { it.first }.toTypedArray())
    }
  }

  override fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    decide(origin, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) { callback.invoke(origin, true, false) }

  /**
   * Asks the app, then runs [grant] or [deny]. False (the core denies) without the prop. Android reports the requesting
   * frame's origin but not the frame: one that isn't the top-level page's is denied (main frame only).
   */
  private fun decide(origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit): Boolean {
    if (!host.handles("permissionRequest")) return false
    val value = originOf(origin)
    if (resources.isEmpty() || value != originOf(host.webView.url)) return true.also { deny() }
    host.ask("permissionRequest", mapOf("origin" to value, "resources" to resources)) { answer ->
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
    val RESOURCES = mapOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE to "camera", PermissionRequest.RESOURCE_AUDIO_CAPTURE to "microphone")
  }
}
