import Foundation

enum Loads {
  /// WebKit reports a load of `https://Example.com:443` as `https://example.com/`.
  static func sameURL(_ a: URL, _ b: URL) -> Bool {
    canonical(a.standardized) == canonical(b.standardized)
  }

  static func canonical(_ url: URL) -> String {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
    components.scheme = components.scheme?.lowercased()
    if let host = components.encodedHost, host != host.lowercased() { components.encodedHost = host.lowercased() }
    if let port = components.port, port == defaultPorts[components.scheme ?? ""] { components.port = nil }
    if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
    return components.string ?? url.absoluteString
  }

  enum Outcome: String {
    case finished, failed, cancelled
  }

  static func ended(by error: NSError) -> (outcome: Outcome, kind: String?) {
    switch (error.domain, error.code) {
    // WebKitErrorFrameLoadInterruptedByPolicyChange: a download, a 204, a blocked redirect.
    case (NSURLErrorDomain, NSURLErrorCancelled), ("WebKitErrorDomain", 102):
      return (outcome: .cancelled, kind: nil)
    // WebKitErrorPlugInWillHandleLoad: WebKit ends the load once a media document has committed, and its video loads the file.
    case ("WebKitErrorDomain", 204):
      return (outcome: .finished, kind: nil)
    case (NSURLErrorDomain, NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed):
      return (outcome: .failed, kind: "ssl")
    default:
      return (outcome: .failed, kind: "network")
    }
  }
}

struct OwnLoads {
  private var loads: [(url: URL, checksBefore: Int)] = []
  private var checks = 0

  mutating func started(_ url: URL) {
    loads.append((url, checks))
  }

  mutating func check(_ target: URL) -> Bool {
    checks += 1
    guard let own = loads.firstIndex(where: { Loads.sameURL($0.url, target) }) else { return false }
    loads.remove(at: own)
    return true
  }

  mutating func committed() {
    loads.removeAll { $0.checksBefore < checks }
  }
}

private let defaultPorts = ["http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21]
