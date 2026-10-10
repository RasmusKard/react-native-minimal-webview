import Foundation

/// HTTP basic and digest auth: asks the app's `onHttpAuthRequest({host, realm})` for `{username, password}` or null
/// (cancel). Without the prop the core cancels.
final class HttpAuth: WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private var declined = Set<String>()

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  func authenticate(_ challenge: URLAuthenticationChallenge, completion: @escaping (URLCredential?) -> Void) -> Bool {
    guard let host, host.handles("httpAuthRequest"), challenge.previousFailureCount < 3 else { return false }
    let space = challenge.protectionSpace
    let key = "\(space.host):\(space.port)/\(space.realm ?? "")"
    // One answer per host and realm until the next page finishes: a server that offers Digest and Basic challenges
    // again with the other scheme after a decline.
    guard !declined.contains(key) else {
      completion(nil)
      return true
    }
    host.ask("httpAuthRequest", ["host": space.host, "realm": space.realm ?? ""]) { [weak self] answer in
      let credential = answer as? [String: Any]
      guard let user = credential?["username"] as? String, let password = credential?["password"] as? String else {
        self?.declined.insert(key)
        return completion(nil)
      }
      completion(URLCredential(user: user, password: password, persistence: .forSession))
    }
    return true
  }

  func didFinish(url: URL?) {
    declined.removeAll()
  }
}
