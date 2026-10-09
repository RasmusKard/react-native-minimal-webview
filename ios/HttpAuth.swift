import Foundation

/// HTTP basic and digest auth: asks the app's `onAuthRequest({host, realm})` for `{username, password}` or null (cancel).
final class HttpAuth: WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  func authenticate(
    _ challenge: URLAuthenticationChallenge,
    completion: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) -> Bool {
    guard let host, challenge.previousFailureCount < 3 else { return false }
    let space = challenge.protectionSpace
    host.ask("authRequest", ["host": space.host, "realm": space.realm ?? ""]) { answer in
      let credential = answer as? [String: Any]
      guard let user = credential?["username"] as? String, let password = credential?["password"] as? String else {
        return completion(.cancelAuthenticationChallenge, nil)
      }
      completion(.useCredential, URLCredential(user: user, password: password, persistence: .forSession))
    }
    return true
  }
}
