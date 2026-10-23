import Foundation

/// Origin rules in Android's format (the bridge's `allowedOrigins`):
/// `*`, an exact http(s) origin such as `https://example.com:8443`, or `https://*.example.com` for subdomains.
/// Compared case-insensitively, a missing port is the scheme's default, and a malformed rule matches nothing.
/// createBridge validates the rules on the JS side. Cases: src/__tests__/vectors/origin-rules.json.
enum OriginRules {
  /// The default port left out (WebKit reports it as 0), an IPv6 host in brackets.
  static func origin(_ scheme: String, _ host: String, _ port: Int) -> String {
    let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
    let host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    return "\(scheme)://\(host)" + (port == 0 || port == defaultPort ? "" : ":\(port)")
  }

  static func allows(_ rules: [String], _ origin: String) -> Bool {
    let value = parse(origin)
    return rules.contains { rule in
      guard let r = parse(rule), let o = value, !o.wildcard else { return rule == "*" }
      return (r.wildcard ? o.host.hasSuffix("." + r.host) : o.host == r.host) && r.scheme == o.scheme && r.port == o.port
    }
  }

  // Built once: a regex literal in the function body is compiled again on every call. Regex isn't Sendable; every
  // caller is a WebKit delegate callback on the main thread.
  nonisolated(unsafe) private static let pattern = #/(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?/#

  private struct Parsed { let scheme: Substring, wildcard: Bool, host: Substring, port: Int }

  private static func parse(_ text: String) -> Parsed? {
    guard let m = try? pattern.wholeMatch(in: text.lowercased()) else { return nil }
    return Parsed(scheme: m.1, wildcard: m.2 != nil, host: m.3, port: m.4.flatMap { Int($0) } ?? (m.1 == "https" ? 443 : 80))
  }
}
