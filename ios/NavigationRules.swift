import Foundation

/// The structured navigation rules. Semantics and cases: test-vectors/navigation-rules.json (shared with Kotlin and TS).
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

  private static let internalSchemes: Set<String> = ["about", "blob", "data", "javascript"]

  static func decide(_ rules: [[String: Any]]?, _ request: Request) -> Decision {
    let scheme = request.url.split(separator: ":", maxSplits: 1).count > 1
      ? String(request.url.prefix { $0 != ":" }).lowercased() : ""
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
    let path = rawPath.isEmpty || components?.host == nil && !rawPath.hasPrefix("/") ? "/" : rawPath
    guard let index = rules.firstIndex(where: { matches($0, scheme, host, path, request) }) else {
      return Decision(action: "block", rule: nil)
    }
    return Decision(action: rules[index]["action"] as? String ?? "block", rule: index)
  }

  private static func strings(_ value: Any?) -> [String]? {
    switch value {
    case nil: return nil
    case let one as String: return [one]
    case let many as [Any]: return many.map { "\($0)" }
    default: return []
    }
  }

  private static func matches(_ rule: [String: Any], _ scheme: String, _ host: String?, _ path: String, _ request: Request) -> Bool {
    if let schemes = strings(rule["scheme"]), !schemes.contains(where: { $0.lowercased() == scheme }) { return false }
    if let hosts = strings(rule["host"]) {
      guard let host, hosts.contains(where: { hostMatches($0.lowercased(), host) }) else { return false }
    }
    if let paths = strings(rule["path"]), !paths.contains(where: { path.hasPrefix($0) }) { return false }
    return flag(rule["mainFrame"], request.mainFrame) && flag(rule["newWindow"], request.newWindow)
      && flag(rule["userInitiated"], request.userInitiated)
  }

  private static func flag(_ value: Any?, _ actual: Bool) -> Bool {
    guard let expected = value as? Bool else { return true }
    return expected == actual
  }

  private static func hostMatches(_ pattern: String, _ host: String) -> Bool {
    pattern.hasPrefix("*.") ? host.hasSuffix(String(pattern.dropFirst())) : host == pattern
  }
}
