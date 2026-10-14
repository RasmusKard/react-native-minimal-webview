import WebKit

/// Camera and microphone for the main frame (the core denies other frames first). WebKit asks the OS itself (the app
/// provides the Info.plist strings). With `onPermissionRequest`, the app decides: true grants without WebKit's own
/// prompt, false denies. Without the prop the core lets WebKit prompt.
final class Permissions {
  private weak var view: MinimalWebView?

  init(view: MinimalWebView) {
    self.view = view
  }

  /// Returns true when the app's prop takes the request; `decide` is then called once.
  func requestMediaCapture(origin: WKSecurityOrigin, type: WKMediaCaptureType, decide: @escaping (WKPermissionDecision) -> Void) -> Bool {
    guard let view, view.requestHandlers.contains("permissionRequest") else { return false }
    let resources: [String] = switch type {
    case .camera: ["camera"]
    case .microphone: ["microphone"]
    default: ["camera", "microphone"]
    }
    view.ask("core.permissionRequest", ["origin": OriginRules.origin(of: origin), "resources": resources]) { answer in
      decide(answer as? Bool == true ? .grant : .deny)
    }
    return true
  }
}
