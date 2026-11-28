import Foundation

enum NavigationRules {
  struct Request {
    let url: String
    let mainFrame: Bool
    let newWindow: Bool
    let userInitiated: Bool

    var payload: [String: Any] {
      ["url": url, "mainFrame": mainFrame, "newWindow": newWindow, "userInitiated": userInitiated]
    }
  }

  enum Action: String { case allow, block, external, ask }

  struct Decision: Equatable {
    let action: Action
    let rule: Int?
  }

  private struct Parts {
    let scheme: String
    let host: String?
    let path: String
    let params: [String]
  }

  private static let internalSchemes: Set<String> = ["about", "data", "javascript"]
  /// WebKit limits what a page may navigate the top frame to.
  private static let noNewWindowSchemes = internalSchemes.union(["blob", "file"])

  static func decide(_ rules: [[String: Any]]?, _ request: Request, asked: Set<String>, canAsk: Bool) -> Decision {
    let decision = match(rules, request)
    guard decision.action == .ask else { return decision }
    if !canAsk { return Decision(action: .block, rule: decision.rule) }
    return asked.contains(request.url) ? Decision(action: .allow, rule: decision.rule) : decision
  }

  static func answer(_ value: Any?) -> Action {
    guard let action = (value as? String).flatMap(Action.init), action != .ask else { return .block }
    return action
  }

  private static func match(_ rules: [[String: Any]]?, _ request: Request) -> Decision {
    let scheme = request.url.firstIndex(of: ":").map { request.url[..<$0].lowercased() } ?? ""
    if request.newWindow, noNewWindowSchemes.contains(scheme) { return Decision(action: .block, rule: nil) }
    if internalSchemes.contains(scheme) { return Decision(action: .allow, rule: nil) }
    guard let rules, !rules.isEmpty,
      let parts = scheme == "blob" ? blobOrigin(request.url) : urlParts(scheme, request.url)
    else { return Decision(action: .block, rule: nil) }
    guard let index = rules.firstIndex(where: { matches($0, parts, request) }) else {
      return Decision(action: .block, rule: nil)
    }
    return Decision(action: (rules[index]["action"] as? String).flatMap(Action.init) ?? .block, rule: index)
  }

  private static func urlParts(_ scheme: String, _ url: String) -> Parts {
    let components = URLComponents(string: url)
    let rawPath = components?.percentEncodedPath ?? ""
    // URLComponents gives `file:///x` an empty host, not none.
    let path = rawPath.isEmpty || components?.host == nil ? "/" : rawPath
    let params = components?.percentEncodedQuery?.split(separator: "&").map(String.init) ?? []
    return Parts(scheme: scheme, host: host(components), path: path, params: params)
  }

  /// A blob: document has the origin its URL carries (`blob:https://a.test/…`).
  private static func blobOrigin(_ url: String) -> Parts? {
    let components = URLComponents(string: String(url.dropFirst("blob:".count)))
    guard let scheme = components?.scheme?.lowercased() else { return nil }
    return Parts(scheme: scheme, host: host(components), path: "/", params: [])
  }

  private static func host(_ components: URLComponents?) -> String? {
    // encodedHost keeps an IDNA host in its xn-- form; `host` would decode it.
    var host = (components?.encodedHost ?? components?.host)?.lowercased()
    if host?.hasSuffix(".") == true { host?.removeLast() }
    return host?.isEmpty == true ? nil : host
  }

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
