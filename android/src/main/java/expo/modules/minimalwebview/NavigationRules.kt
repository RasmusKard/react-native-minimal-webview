package expo.modules.minimalwebview

/** The structured navigation rules. Semantics and cases: src/__tests__/vectors/navigation-rules.json (shared with Swift). */
internal object NavigationRules {
  data class Request(
    val url: String,
    val mainFrame: Boolean,
    val newWindow: Boolean,
    val userInitiated: Boolean,
    val isRedirect: Boolean = false
  )

  /** [action] is allow, block, external or ask; [rule] is the matching rule's index, null when a default decided. */
  data class Decision(val action: String, val rule: Int?)

  private val internalSchemes = setOf("about", "blob", "data", "javascript")
  private val actions = setOf("allow", "block", "external", "ask")
  private val answers = setOf("allow", "block", "external")

  /**
   * The rules' decision, gated for `ask`: blocked when nothing can answer it ([canAsk] false), allowed when its URL is
   * in [asked] (URLs an `ask` already allowed). An unknown rule action blocks.
   */
  fun decide(rules: List<Map<String, Any?>>?, request: Request, asked: Set<String>, canAsk: Boolean): Decision {
    val decision = match(rules, request)
    return when {
      decision.action != "ask" -> decision
      !canAsk -> Decision("block", decision.rule)
      request.url in asked -> Decision("allow", decision.rule)
      else -> decision
    }
  }

  /** An `ask` answer: allow, block or external; anything else (null on a timeout) blocks. */
  fun answer(value: Any?): String = (value as? String)?.takeIf { it in answers } ?: "block"

  private fun match(rules: List<Map<String, Any?>>?, request: Request): Decision {
    val scheme = request.url.substringBefore(':', "").lowercase()
    // The core loads an allowed new window in the main frame itself, past the engine's limits on what a page may
    // navigate the top frame to, so internal schemes and file: never open as a new window, whatever the rules say.
    if (request.newWindow && (scheme in internalSchemes || scheme == "file")) return Decision("block", null)
    if (scheme in internalSchemes) return Decision("allow", null)
    // JS sends defaultNavigationRules when the prop is unset; no rules, null or empty, match nothing.
    if (rules.isNullOrEmpty()) return Decision("block", null)
    val parts = parts(scheme, request.url)
    val index = rules.indexOfFirst { matches(it, parts, request) }
    return if (index < 0) Decision("block", null) else Decision((rules[index]["action"] as? String)?.takeIf { it in actions } ?: "block", index)
  }

  // scheme ":" ["//" authority] path ["?" query]. java.net.URI rejects URLs Chromium accepts (a raw `|` in the query,
  // `_` in a host), so the parts are split with a regex.
  private val urlParts = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?")

  private data class Parts(val scheme: String, val host: String?, val path: String, val params: List<String>)

  private fun parts(scheme: String, url: String): Parts {
    val match = urlParts.find(url) ?: return Parts(scheme, null, "/", emptyList())
    val authority = match.groups[2]?.value
    val path = match.groupValues[3]
    val params = match.groups[4]?.value?.split('&')?.filter { it.isNotEmpty() }.orEmpty()
    return Parts(scheme, hostOf(authority), if (authority != null && path.isNotEmpty()) path else "/", params)
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

  private fun matches(rule: Map<String, Any?>, parts: Parts, request: Request): Boolean {
    val (scheme, host, path, params) = parts
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
