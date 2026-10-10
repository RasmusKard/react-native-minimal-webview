import WebKit

/// Origin rules in Android's format (the bridge's `allowedOrigins`, the permissions extension's `origins`):
/// `*`, an exact origin such as `https://example.com:8443`, or `https://*.example.com` for subdomains.
/// Compared case-insensitively. createBridge validates the rules on the JS side.
enum OriginRules {
  static func origin(of security: WKSecurityOrigin) -> String {
    "\(security.protocol)://\(security.host)" + (security.port == 0 ? "" : ":\(security.port)")
  }

  static func allows(_ rules: [String], _ origin: String) -> Bool {
    let value = origin.lowercased()
    return rules.contains { original in
      let rule = original.lowercased()
      guard let wildcard = rule.range(of: "://*.") else { return rule == "*" || rule == value }
      return value.hasPrefix(rule[..<wildcard.lowerBound] + "://") && value.hasSuffix("." + rule[wildcard.upperBound...])
    }
  }
}
