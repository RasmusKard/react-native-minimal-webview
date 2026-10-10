package expo.modules.minimalwebview.extensions

import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension

/**
 * Camera, microphone and location for pages on the configured origins (main frame only). The app's
 * `onPermissionRequest({origin, resources})` may request OS permission and answers true or false; without a handler,
 * the origin list alone decides. Never prompts by itself: a grant the OS has not allowed still fails in the page.
 */
class Permissions : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var origins: List<String> = emptyList()

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
    origins = (config["origins"] as? List<*>)?.map { it.toString() } ?: emptyList()
  }

  override fun onPermissionRequest(request: PermissionRequest): Boolean {
    val origin = request.origin.toString().trimEnd('/')
    val wanted = request.resources.mapNotNull { RESOURCES[it]?.let { name -> it to name } }
    // Android reports the requesting frame's origin: the top-level page must be allowed too (main frame only).
    if (!allowed(origin) || !allowed(topOrigin()) || wanted.isEmpty()) {
      request.deny()
      return true
    }
    decide(origin, wanted.map { it.second }, deny = request::deny) { request.grant(wanted.map { it.first }.toTypedArray()) }
    return true
  }

  override fun onGeolocationPrompt(origin: String, callback: GeolocationPermissions.Callback): Boolean {
    val trimmed = origin.trimEnd('/')
    if (!allowed(trimmed) || !allowed(topOrigin())) {
      callback.invoke(origin, false, false)
      return true
    }
    decide(trimmed, listOf("geolocation"), deny = { callback.invoke(origin, false, false) }) { callback.invoke(origin, true, false) }
    return true
  }

  /** Runs [grant] when the app agrees (or there is no handler), else [deny]. */
  private fun decide(origin: String, resources: List<String>, deny: () -> Unit, grant: () -> Unit) {
    if (!host.handles("permissionRequest")) return grant()
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
