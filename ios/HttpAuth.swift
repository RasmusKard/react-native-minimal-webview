import Foundation

/// HTTP basic and digest auth: asks the app's `onHttpAuthRequest({host, realm})` for `{username, password}` or null
/// (cancel). Without the prop the core cancels.
final class HttpAuth {
  private weak var view: MinimalWebView?
  private var declined = Set<String>()

  init(view: MinimalWebView) {
    self.view = view
  }

  /// Returns true when the app's prop takes the challenge; `completion` is then called once, with nil to decline.
  func authenticate(_ challenge: URLAuthenticationChallenge, completion: @escaping (URLCredential?) -> Void) -> Bool {
    guard let view, view.requestHandlers.contains("httpAuthRequest"), challenge.previousFailureCount < 3 else { return false }
    let space = challenge.protectionSpace
    let key = "\(space.host):\(space.port)/\(space.realm ?? "")"
    // One answer per host and realm until the next page finishes: a server that offers Digest and Basic challenges
    // again with the other scheme after a decline.
    guard !declined.contains(key) else {
      completion(nil)
      return true
    }
    view.ask("core.httpAuthRequest", ["host": space.host, "realm": space.realm ?? ""]) { [weak self] answer in
      let credential = answer as? [String: Any]
      guard let user = credential?["username"] as? String, let password = credential?["password"] as? String else {
        self?.declined.insert(key)
        return completion(nil)
      }
      completion(URLCredential(user: user, password: password, persistence: .forSession))
    }
    return true
  }

  func pageFinished() {
    declined.removeAll()
  }
}
