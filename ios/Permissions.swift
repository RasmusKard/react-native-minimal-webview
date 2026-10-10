import WebKit

/// Camera and microphone for the main frame (the core denies other frames first). WebKit asks the OS itself (the app
/// provides the Info.plist strings). With `onPermissionRequest`, the app decides: true grants without WebKit's own
/// prompt, false denies. Without the prop the core lets WebKit prompt.
final class Permissions: WebViewExtension {
  // Strong: nothing else retains the host, and it holds the view weakly.
  private var host: ExtensionHost?

  func attach(host: ExtensionHost, config: [String: Any]) {
    self.host = host
  }

  func requestMediaCapture(origin: WKSecurityOrigin, type: WKMediaCaptureType, decide: @escaping (WKPermissionDecision) -> Void) -> Bool {
    guard let host, host.handles("permissionRequest") else { return false }
    let resources: [String] = switch type {
    case .camera: ["camera"]
    case .microphone: ["microphone"]
    default: ["camera", "microphone"]
    }
    host.ask("permissionRequest", ["origin": OriginRules.origin(of: origin), "resources": resources]) { answer in
      decide(answer as? Bool == true ? .grant : .deny)
    }
    return true
  }
}
