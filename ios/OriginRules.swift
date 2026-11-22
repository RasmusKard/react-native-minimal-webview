import Foundation
import WebKit

enum OriginRules {
  /// The origin as `location.origin` writes it: `null` for an opaque one (no scheme). WebKit reports a default port as 0.
  static func origin(_ scheme: String, _ host: String, _ port: Int) -> String {
    guard !scheme.isEmpty else { return "null" }
    let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
    let host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    return "\(scheme)://\(host)" + (port == 0 || port == defaultPort ? "" : ":\(port)")
  }

  static func origin(of security: WKSecurityOrigin) -> String {
    origin(security.protocol, security.host, security.port)
  }

  @MainActor static func allows(_ rules: [String], _ origin: String) -> Bool {
    let value = parse(origin)
    return rules.contains { rule in
      guard let r = parse(rule), let o = value, !o.wildcard else { return rule == "*" }
      return (r.wildcard ? o.host.hasSuffix("." + r.host) : o.host == r.host) && r.scheme == o.scheme && r.port == o.port
    }
  }

  @MainActor private static let pattern = #/(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?/#

  private struct Parsed { let scheme: Substring, wildcard: Bool, host: Substring, port: Int }

  @MainActor private static func parse(_ text: String) -> Parsed? {
    guard let m = try? pattern.wholeMatch(in: text.lowercased()) else { return nil }
    return Parsed(scheme: m.1, wildcard: m.2 != nil, host: m.3, port: m.4.flatMap { Int($0) } ?? (m.1 == "https" ? 443 : 80))
  }
}
