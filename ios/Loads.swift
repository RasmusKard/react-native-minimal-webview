import Foundation

enum Loads {
  /// Whether `a` and `b` are the same URL as WebKit reports one: WebKit reports a load of `https://Example.com:443` as
  /// `https://example.com/`.
  static func sameURL(_ a: URL, _ b: URL) -> Bool {
    canonical(a.standardized) == canonical(b.standardized)
  }

  /// `url` in the form `sameURL` compares, dot segments aside.
  static func canonical(_ url: URL) -> String {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
    components.scheme = components.scheme?.lowercased()
    if let host = components.encodedHost, host != host.lowercased() { components.encodedHost = host.lowercased() }
    if let port = components.port, port == defaultPorts[components.scheme ?? ""] { components.port = nil }
    if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
    return components.string ?? url.absoluteString
  }

  static func ended(by error: NSError) -> (outcome: String, kind: String?) {
    switch (error.domain, error.code) {
    // WebKitErrorFrameLoadInterruptedByPolicyChange: a download, a 204, a blocked redirect.
    case (NSURLErrorDomain, NSURLErrorCancelled), ("WebKitErrorDomain", 102):
      return (outcome: "cancelled", kind: nil)
    // WebKitErrorPlugInWillHandleLoad: WebKit ends the load once a media document has committed, and its video loads the file.
    case ("WebKitErrorDomain", 204):
      return (outcome: "finished", kind: nil)
    case (NSURLErrorDomain, NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed):
      return (outcome: "failed", kind: "ssl")
    default:
      return (outcome: "failed", kind: "network")
    }
  }
}

private let defaultPorts = ["http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21]
