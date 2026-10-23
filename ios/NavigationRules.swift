import Foundation

/// The structured navigation rules. Semantics and cases: src/__tests__/vectors/navigation-rules.json (shared with Kotlin).
enum NavigationRules {
  struct Request {
    let url: String
    let mainFrame: Bool
    let newWindow: Bool
    let userInitiated: Bool

    /// The fields JS events carry.
    var payload: [String: Any] {
      ["url": url, "mainFrame": mainFrame, "newWindow": newWindow, "userInitiated": userInitiated]
    }
  }

  /// `action` is allow, block, external or ask; `rule` is the matching rule's index, nil when a default decided.
  struct Decision: Equatable {
    let action: String
    let rule: Int?
  }

  /// The scheme, host, path and the query's `&`-separated parameters that rules match.
  private struct Parts {
    let scheme: String
    let host: String?
    let path: String
    let params: [String]
  }

  private static let internalSchemes: Set<String> = ["about", "blob", "data", "javascript"]
  private static let actions: Set<String> = ["allow", "block", "external", "ask"]
  private static let answers: Set<String> = ["allow", "block", "external"]

  /// The rules' decision, gated for `ask`: blocked when nothing can answer it (`canAsk` false), allowed when its URL is
  /// in `asked` (URLs an `ask` already allowed). An unknown rule action blocks.
  static func decide(_ rules: [[String: Any]]?, _ request: Request, asked: Set<String> = [], canAsk: Bool = true) -> Decision {
    let decision = match(rules, request)
    guard decision.action == "ask" else { return decision }
    if !canAsk { return Decision(action: "block", rule: decision.rule) }
    return asked.contains(request.url) ? Decision(action: "allow", rule: decision.rule) : decision
  }

  /// An `ask` answer: allow, block or external; anything else (nil on a timeout) blocks.
  static func answer(_ value: Any?) -> String {
    (value as? String).flatMap { answers.contains($0) ? $0 : nil } ?? "block"
  }

  private static func match(_ rules: [[String: Any]]?, _ request: Request) -> Decision {
    let scheme = request.url.split(separator: ":", maxSplits: 1).count > 1
      ? String(request.url.prefix { $0 != ":" }).lowercased() : ""
    // The core loads an allowed new window in the main frame itself, past the engine's limits on what a page may
    // navigate the top frame to, so internal schemes and file: never open as a new window, whatever the rules say.
    if request.newWindow, internalSchemes.contains(scheme) || scheme == "file" { return Decision(action: "block", rule: nil) }
    if internalSchemes.contains(scheme) { return Decision(action: "allow", rule: nil) }
    guard let rules, !rules.isEmpty else {
      switch scheme {
      case "http", "https": return Decision(action: "allow", rule: nil)
      case "file": return Decision(action: "block", rule: nil)
      // an iframe (an ad) must not launch apps, so only the main frame goes external
      default: return Decision(action: request.mainFrame ? "external" : "block", rule: nil)
      }
    }
    // ponytail: an unparseable URL has no host and path "/", so only rules without host conditions match it
    let components = URLComponents(string: request.url)
    // encodedHost keeps IDNA hosts in their xn-- form; `host` would decode them
    var host = (components?.encodedHost ?? components?.host)?.lowercased()
    if host?.hasSuffix(".") == true { host?.removeLast() }
    if host?.isEmpty == true { host = nil }
    let rawPath = components?.percentEncodedPath ?? ""
    // No authority (`myapp:/abs`, `myapp:open`): the path is "/", as in Kotlin. `file:///x` has an empty one, not none.
    let path = rawPath.isEmpty || components?.host == nil ? "/" : rawPath
    let params = components?.percentEncodedQuery?.split(separator: "&").map(String.init) ?? []
    let parts = Parts(scheme: scheme, host: host, path: path, params: params)
    guard let index = rules.firstIndex(where: { matches($0, parts, request) }) else {
      return Decision(action: "block", rule: nil)
    }
    let action = rules[index]["action"] as? String
    return Decision(action: action.flatMap { actions.contains($0) ? $0 : nil } ?? "block", rule: index)
  }

  /// nil when the field is unset; a value that isn't a list (a string from untyped JS) matches nothing.
  private static func list(_ value: Any?) -> [String]? {
    value.map { ($0 as? [Any])?.map { "\($0)" } ?? [] }
  }

  private static func matches(_ rule: [String: Any], _ parts: Parts, _ request: Request) -> Bool {
    if let schemes = list(rule["scheme"]), !schemes.contains(where: { $0.lowercased() == parts.scheme }) { return false }
    if let hosts = list(rule["host"]) {
      guard let host = parts.host, hosts.contains(where: { hostMatches($0.lowercased(), host) }) else { return false }
    }
    if let paths = list(rule["path"]), !paths.contains(where: { parts.path.hasPrefix($0) }) { return false }
    if let queries = list(rule["query"]), !queries.contains(where: { paramMatches($0, parts.params) }) { return false }
    return flag(rule["mainFrame"], request.mainFrame) && flag(rule["newWindow"], request.newWindow)
      && flag(rule["userInitiated"], request.userInitiated)
  }

  /// `name=value` matches that exact parameter; `name` matches a parameter with that name, whatever its value.
  private static func paramMatches(_ entry: String, _ params: [String]) -> Bool {
    params.contains { param in entry.contains("=") ? param == entry : param.prefix(while: { $0 != "=" }) == entry }
  }

  private static func flag(_ value: Any?, _ actual: Bool) -> Bool {
    guard let expected = value as? Bool else { return true }
    return expected == actual
  }

  private static func hostMatches(_ pattern: String, _ host: String) -> Bool {
    pattern.hasPrefix("*.") ? host.hasSuffix(String(pattern.dropFirst())) : host == pattern
  }
}
