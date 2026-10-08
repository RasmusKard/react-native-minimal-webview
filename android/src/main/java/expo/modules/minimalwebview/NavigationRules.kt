package expo.modules.minimalwebview

import java.net.URI

/** The structured navigation rules. Semantics and cases: test-vectors/navigation-rules.json (shared with Swift and TS). */
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
        else -> "external"
      }
      return Decision(action, null)
    }
    val (host, path) = hostAndPath(request.url)
    val index = rules.indexOfFirst { matches(it, scheme, host, path, request) }
    return if (index < 0) Decision("block", null) else Decision(rules[index]["action"] as? String ?: "block", index)
  }

  // ponytail: an unparseable URL has no host and path "/", so only rules without host conditions match it
  private fun hostAndPath(url: String): Pair<String?, String> {
    val uri = runCatching { URI(url) }.getOrNull()
    return uri?.host?.lowercase()?.removeSuffix(".") to (uri?.rawPath ?: "").ifEmpty { "/" }
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
