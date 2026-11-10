import Foundation

/// The main-frame loads' choices that need no WebView.
enum Loads {
  /// Whether `a` and `b` are the same URL as WebKit reports one: with the scheme and host lowercase, the scheme's
  /// default port dropped and an empty path `/`. The rest (userinfo, path, query, fragment) compares exactly. It picks
  /// out our own loads (`programmaticUrl`), which skip the navigation rules: WebKit reports the load of a `source.uri`
  /// of `https://Example.com:443` as `https://example.com/`.
  static func sameURL(_ a: URL, _ b: URL) -> Bool {
    canonical(a) == canonical(b)
  }

  private static func canonical(_ url: URL) -> String {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
    components.scheme = components.scheme?.lowercased()
    if let host = components.encodedHost, host != host.lowercased() { components.encodedHost = host.lowercased() }
    if let port = components.port, port == defaultPorts[components.scheme ?? ""] { components.port = nil }
    if components.percentEncodedPath.isEmpty { components.percentEncodedPath = "/" }
    return components.string ?? url.absoluteString
  }

  /// How a main-frame load WebKit ended with `error` went: its outcome, and the `onError` kind when it failed.
  static func ended(by error: NSError) -> (outcome: String, kind: String?) {
    switch (error.domain, error.code) {
    // Superseded or stopped (NSURLErrorCancelled), or a policy cancel (WebKitErrorFrameLoadInterruptedByPolicyChange:
    // a download, a 204, a blocked redirect): not an error.
    case (NSURLErrorDomain, NSURLErrorCancelled), ("WebKitErrorDomain", 102):
      return (outcome: "cancelled", kind: nil)
    // WebKitErrorPlugInWillHandleLoad: a media file. WebKit ends the load once its media document has committed, and
    // the document's video loads the file itself (WebLocalFrameLoaderClient::committedLoad): the page shows, as on
    // Android.
    case ("WebKitErrorDomain", 204):
      return (outcome: "finished", kind: nil)
    // The TLS handshake and certificate errors.
    case (NSURLErrorDomain, NSURLErrorClientCertificateRequired...NSURLErrorSecureConnectionFailed):
      return (outcome: "failed", kind: "ssl")
    default:
      return (outcome: "failed", kind: "network")
    }
  }
}

/// The special schemes' default ports, which WebKit drops from a URL (the WHATWG URL Standard's).
private let defaultPorts = ["http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21]
