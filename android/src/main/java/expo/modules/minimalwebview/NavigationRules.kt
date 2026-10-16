package expo.modules.minimalwebview

/** The structured navigation rules. Semantics and cases: src/__tests__/vectors/navigation-rules.json (shared with Swift). */
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
    val (host, path, params) = parts(request.url)
    val index = rules.indexOfFirst { matches(it, scheme, host, path, params, request) }
    return if (index < 0) Decision("block", null) else Decision(rules[index]["action"] as? String ?: "block", index)
  }

  // scheme ":" ["//" authority] path ["?" query]. java.net.URI rejects URLs Chromium accepts (a raw `|` in the query,
  // `_` in a host), so the parts are split with a regex.
  private val urlParts = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?")

  /** Host, path and the query's `&`-separated parameters. */
  private fun parts(url: String): Triple<String?, String, List<String>> {
    val match = urlParts.find(url) ?: return Triple(null, "/", emptyList())
    val authority = match.groups[2]?.value
    val path = match.groupValues[3]
    val params = match.groups[4]?.value?.split('&')?.filter { it.isNotEmpty() }.orEmpty()
    return Triple(hostOf(authority), if (authority != null && path.isNotEmpty()) path else "/", params)
  }

  /** Host without userinfo, port or a trailing dot, lowercased; null when there is none. */
  private fun hostOf(authority: String?): String? {
    if (authority.isNullOrEmpty()) return null
    val withoutUser = authority.substringAfterLast('@')
    val host = if (withoutUser.startsWith("[")) withoutUser.substringBefore(']') + "]" else withoutUser.replace(Regex(":\\d*$"), "")
    return host.lowercase().removeSuffix(".").ifEmpty { null }
  }

  /** null when the field is unset; a value that isn't a list (a string from untyped JS) matches nothing. */
  private fun list(value: Any?): List<String>? = value?.let { (it as? List<*>)?.map(Any?::toString).orEmpty() }

  private fun matches(rule: Map<String, Any?>, scheme: String, host: String?, path: String, params: List<String>, request: Request): Boolean {
    val schemes = list(rule["scheme"])
    val hosts = list(rule["host"])
    val paths = list(rule["path"])
    val queries = list(rule["query"])
    return (schemes == null || schemes.any { it.equals(scheme, ignoreCase = true) }) &&
      (hosts == null || host != null && hosts.any { hostMatches(it.lowercase(), host) }) &&
      (paths == null || paths.any { path.startsWith(it) }) &&
      (queries == null || queries.any { paramMatches(it, params) }) &&
      flag(rule, "mainFrame", request.mainFrame) &&
      flag(rule, "newWindow", request.newWindow) &&
      flag(rule, "userInitiated", request.userInitiated)
  }

  /** `name=value` matches that exact parameter; `name` matches a parameter with that name, whatever its value. */
  private fun paramMatches(entry: String, params: List<String>) =
    params.any { if ('=' in entry) it == entry else it.substringBefore('=') == entry }

  private fun flag(rule: Map<String, Any?>, name: String, value: Boolean) = (rule[name] as? Boolean)?.let { it == value } ?: true

  private fun hostMatches(pattern: String, host: String) =
    if (pattern.startsWith("*.")) host.endsWith(pattern.substring(1)) else host == pattern
}
