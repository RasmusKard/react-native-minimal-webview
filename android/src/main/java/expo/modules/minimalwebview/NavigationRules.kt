package expo.modules.minimalwebview

/** The structured navigation rules. Semantics and cases: test-vectors/navigation-rules.json (shared with Swift). */
object NavigationRules {
  data class Request(val url: String, val mainFrame: Boolean, val newWindow: Boolean, val userInitiated: Boolean)

  /** [action] is allow, block, external or ask; [rule] is the matching rule's index, null when a default decided. */
  data class Decision(val action: String, val rule: Int?)

  private val internalSchemes = setOf("about", "blob", "data", "javascript")

  fun decide(rules: List<Map<String, Any?>>?, request: Request): Decision {
    val scheme = request.url.substringBefore(':', "").lowercase()
    if (scheme in internalSchemes) return Decision("allow", null)
    if (rules.isNullOrEmpty()) {
      val action = when (scheme) {
        "http", "https" -> "allow"
        "file" -> "block"
        // an iframe (an ad) must not launch apps, so only the main frame goes external
        else -> if (request.mainFrame) "external" else "block"
      }
      return Decision(action, null)
    }
    val (host, path) = hostAndPath(request.url)
    val index = rules.indexOfFirst { matches(it, scheme, host, path, request) }
    return if (index < 0) Decision("block", null) else Decision(rules[index]["action"] as? String ?: "block", index)
  }

  // scheme ":" ["//" authority] path. java.net.URI rejects URLs Chromium accepts (a raw `|` in the query, `_` in a
  // host), so the parts are split with a regex.
  private val urlParts = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(?://([^/?#]*))?([^?#]*)")

  private fun hostAndPath(url: String): Pair<String?, String> {
    val match = urlParts.find(url) ?: return null to "/"
    val authority = match.groups[2]?.value
    val path = match.groupValues[3]
    return hostOf(authority) to if (authority != null && path.isNotEmpty()) path else "/"
  }

  /** Host without userinfo, port or a trailing dot, lowercased; null when there is none. */
  private fun hostOf(authority: String?): String? {
    if (authority.isNullOrEmpty()) return null
    val withoutUser = authority.substringAfterLast('@')
    val host = if (withoutUser.startsWith("[")) withoutUser.substringBefore(']') + "]" else withoutUser.replace(Regex(":\\d*$"), "")
    return host.lowercase().removeSuffix(".").ifEmpty { null }
  }

  private fun strings(value: Any?): List<String>? = when (value) {
    null -> null
    is String -> listOf(value)
    is List<*> -> value.map { it.toString() }
    else -> emptyList()
  }

  private fun matches(rule: Map<String, Any?>, scheme: String, host: String?, path: String, request: Request): Boolean {
    val schemes = strings(rule["scheme"])
    val hosts = strings(rule["host"])
    val paths = strings(rule["path"])
    return (schemes == null || schemes.any { it.equals(scheme, ignoreCase = true) }) &&
      (hosts == null || host != null && hosts.any { hostMatches(it.lowercase(), host) }) &&
      (paths == null || paths.any { path.startsWith(it) }) &&
      flag(rule, "mainFrame", request.mainFrame) &&
      flag(rule, "newWindow", request.newWindow) &&
      flag(rule, "userInitiated", request.userInitiated)
  }

  private fun flag(rule: Map<String, Any?>, name: String, value: Boolean) = (rule[name] as? Boolean)?.let { it == value } ?: true

  private fun hostMatches(pattern: String, host: String) =
    if (pattern.startsWith("*.")) host.endsWith(pattern.substring(1)) else host == pattern
}
