package expo.modules.minimalwebview.extensions

import android.Manifest
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * Camera, microphone and location for pages on the configured origins (main frame only). The app's
 * `onPermissionRequest({origin, resources})` may request OS permission and answers true or false. Native grants only
 * when the app said yes AND the OS permission is granted. Without a handler: grant if the OS permission is already
 * granted. Never prompts by itself.
 */
class Permissions : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var origins: List<String> = emptyList()
  private var hasHandler = false

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
    origins = (config["origins"] as? List<*>)?.map { it.toString() } ?: emptyList()
    hasHandler = config["hasHandler"] == true
  }

  override fun onPermissionRequest(request: PermissionRequest): Boolean {
    val origin = request.origin.toString().trimEnd('/')
    val wanted = request.resources.mapNotNull { RESOURCES[it]?.let { name -> it to name } }
    // Android reports the requesting frame's origin: the top-level page must be allowed too (main frame only).
    if (!allowed(origin) || !allowed(topOrigin()) || wanted.isEmpty()) {
      request.deny()
      return true
    }
    decide(origin, wanted.map { it.second }, deny = request::deny) {
      val grantable = wanted.filter { (_, name) -> host.hasPermission(OS_PERMISSIONS.getValue(name)) }.map { it.first }
      if (grantable.isEmpty()) request.deny() else request.grant(grantable.toTypedArray())
    }
    return true
  }

  override fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback): Boolean {
    val trimmed = origin.trimEnd('/')
    if (!allowed(trimmed) || !allowed(topOrigin())) {
      callback.invoke(origin, false, false)
      return true
    }
    decide(trimmed, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) {
      val granted = host.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
        host.hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
      callback.invoke(origin, granted, false)
    }
    return true
  }

  /** Runs [grant] when the app agrees (or there is no handler), else [deny]. [grant] still checks the OS permission. */
  private fun decide(origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit) {
    if (!hasHandler) return grant()
    host.ask("permissionRequest", mapOf("origin" to origin, "resources" to resources)) { answer ->
      if (answer == true) grant() else deny()
    }
  }

  private fun topOrigin(): String {
    val uri = android.net.Uri.parse(host.webView.url ?: return "")
    val port = if (uri.port == -1) "" else ":${uri.port}"
    return "${uri.scheme}://${uri.host}$port"
  }

  private fun allowed(origin: String) = OriginRules.allows(origins, origin)

  private companion object {
    val RESOURCES = mapOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE to "camera", PermissionRequest.RESOURCE_AUDIO_CAPTURE to "microphone")
    val OS_PERMISSIONS = mapOf("camera" to Manifest.permission.CAMERA, "microphone" to Manifest.permission.RECORD_AUDIO)
  }
}

// Origin rules in the bridge's format, as OriginRules.swift: `*`, an exact http(s) origin, or `https://*.example.com` for
// subdomains. Case-insensitive, a missing port is the scheme's default, and a malformed rule matches nothing.
internal object OriginRules {
  private val FORMAT = Regex("""(https?)://(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?""")

  private data class Parsed(val scheme: String, val wildcard: Boolean, val host: String, val port: Int)

  private fun parse(text: String) = FORMAT.matchEntire(text.lowercase())?.groupValues?.let { (_, scheme, wildcard, host, port) ->
    Parsed(scheme, wildcard.isNotEmpty(), host, port.toIntOrNull() ?: if (scheme == "https") 443 else 80)
  }

  fun allows(rules: List<String>, origin: String): Boolean {
    val o = parse(origin)?.takeUnless { it.wildcard }
    return rules.any { rule ->
      val r = parse(rule)
      if (r == null || o == null) rule == "*"
      else (if (r.wildcard) o.host.endsWith(".${r.host}") else o.host == r.host) && r.scheme == o.scheme && r.port == o.port
    }
  }
}
