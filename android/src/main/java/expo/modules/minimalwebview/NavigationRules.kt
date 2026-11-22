package expo.modules.minimalwebview

internal object NavigationRules {
  data class Request(
    val url: String,
    val mainFrame: Boolean,
    val newWindow: Boolean,
    val userInitiated: Boolean,
    val isRedirect: Boolean = false
  )

  enum class Action(val jsName: String) { ALLOW("allow"), BLOCK("block"), EXTERNAL("external"), ASK("ask") }

  /** [rule] is the index of the rule that decided, null when a default did. */
  data class Decision(val action: Action, val rule: Int?)

  private val schemesAllowedWithoutRules = setOf("about", "data", "javascript")

  /**
   * Never open as a new window, whatever the rules say: the core loads an allowed new window in the main frame itself,
   * past the engine's limits on what a page may navigate the top frame to.
   */
  private val noNewWindowSchemes = schemesAllowedWithoutRules + setOf("blob", "file")

  private fun actionOf(value: Any?) = Action.entries.find { it.jsName == value }

  /**
   * The rules' decision, gated for `ask`: blocked when nothing can answer it ([canAsk] false), allowed when its URL is
   * in [asked] (URLs an `ask` already allowed). An unknown rule action blocks.
   */
  fun decide(rules: List<Map<String, Any?>>?, request: Request, asked: Set<String>, canAsk: Boolean): Decision {
    val decision = match(rules, request)
    return when {
      decision.action != Action.ASK -> decision
      !canAsk -> Decision(Action.BLOCK, decision.rule)
      request.url in asked -> Decision(Action.ALLOW, decision.rule)
      else -> decision
    }
  }

  /** An `ask` answer: allow, block or external; anything else (null on a timeout) blocks. */
  fun answer(value: Any?): Action = actionOf(value)?.takeIf { it != Action.ASK } ?: Action.BLOCK

  private fun match(rules: List<Map<String, Any?>>?, request: Request): Decision {
    val scheme = request.url.substringBefore(':', "").lowercase()
    if (request.newWindow && scheme in noNewWindowSchemes) return Decision(Action.BLOCK, null)
    if (scheme in schemesAllowedWithoutRules) return Decision(Action.ALLOW, null)
    if (rules.isNullOrEmpty()) return Decision(Action.BLOCK, null)
    val parts = (if (scheme == "blob") blobOrigin(request.url) else parts(scheme, request.url))
      ?: return Decision(Action.BLOCK, null)
    val index = rules.indexOfFirst { matches(it, parts, request) }
    return if (index < 0) Decision(Action.BLOCK, null) else Decision(actionOf(rules[index]["action"]) ?: Action.BLOCK, index)
  }

  // java.net.URI rejects URLs Chromium accepts (a raw `|` in the query, `_` in a host), so the parts are split with a
  // regex.
  private val urlParts = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?")

  private data class Parts(val scheme: String, val host: String?, val path: String, val params: List<String>)

  private fun parts(scheme: String, url: String): Parts {
    val match = urlParts.find(url) ?: return Parts(scheme, null, "/", emptyList())
    val authority = match.groups[2]?.value
    val path = match.groupValues[3]
    val params = match.groups[4]?.value?.split('&')?.filter { it.isNotEmpty() }.orEmpty()
    return Parts(scheme, hostOf(authority), if (authority != null && path.isNotEmpty()) path else "/", params)
  }

  /**
   * A blob: document has the origin its URL carries (`blob:https://a.test/…`), so the rules see that origin, with
   * path "/"; null for an opaque one (`blob:null/…`), which no rule describes.
   */
  private fun blobOrigin(url: String): Parts? {
    val match = urlParts.find(url.substringAfter(':')) ?: return null
    return Parts(match.groupValues[1].lowercase(), hostOf(match.groups[2]?.value), "/", emptyList())
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
