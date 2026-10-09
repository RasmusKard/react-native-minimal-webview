import WebKit

/// Origin rules in Android's format (the bridge's `allowedOrigins`, the permissions extension's `origins`):
/// `*`, an exact http(s) origin such as `https://example.com:8443`, or `https://*.example.com` for subdomains.
/// Compared case-insensitively, a missing port is the scheme's default, and a malformed rule matches nothing.
/// createBridge validates the rules on the JS side. Cases: test-vectors/origin-rules.json.
enum OriginRules {
  static func origin(of security: WKSecurityOrigin) -> String {
    "\(security.protocol)://\(security.host)" + (security.port == 0 ? "" : ":\(security.port)")
  }

  static func allows(_ rules: [String], _ origin: String) -> Bool {
    let value = parse(origin)
    return rules.contains { rule in
      guard let r = parse(rule), let o = value, !o.wildcard else { return rule == "*" }
      return (r.wildcard ? o.host.hasSuffix("." + r.host) : o.host == r.host) && r.scheme == o.scheme && r.port == o.port
    }
  }

  private static func parse(_ text: String) -> (scheme: Substring, wildcard: Bool, host: Substring, port: Int)? {
    guard let m = try? #/(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?/#
      .wholeMatch(in: text.lowercased()) else { return nil }
    return (m.1, m.2 != nil, m.3, m.4.flatMap { Int($0) } ?? (m.1 == "https" ? 443 : 80))
  }
}
