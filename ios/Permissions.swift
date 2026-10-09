import WebKit

/// Camera and microphone for pages on the configured origins (main frame only). WebKit asks the OS itself (the app
/// provides the Info.plist strings). With `onPermissionRequest`, the app decides first: true grants without WebKit's
/// own prompt, false denies. Without a handler WebKit prompts as usual. Other origins are denied.
final class Permissions: WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?
  private var origins: [String] = []

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
    origins = config["origins"] as? [String] ?? []
  }

  func requestMediaCapture(origin: WKSecurityOrigin, type: WKMediaCaptureType, decide: @escaping (WKPermissionDecision) -> Void) -> Bool {
    let value = OriginRules.origin(of: origin)
    guard OriginRules.allows(origins, value) else {
      decide(.deny)
      return true
    }
    guard let host, host.handles("permissionRequest") else {
      decide(.prompt)
      return true
    }
    let resources: [String] = switch type {
    case .camera: ["camera"]
    case .microphone: ["microphone"]
    default: ["camera", "microphone"]
    }
    host.ask("permissionRequest", ["origin": value, "resources": resources]) { answer in
      decide(answer as? Bool == true ? .grant : .deny)
    }
    return true
  }

}
