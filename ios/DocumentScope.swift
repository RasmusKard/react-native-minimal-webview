/// Why a Document ended, as ``WebViewContext/onDocumentEnd(_:)`` and ``WebViewContext/onDestroyed(_:)`` report it.
///
/// A Document is the main-frame page on screen: from a navigation's commit, a back-forward-cache restore included, to
/// the next commit, a web content process crash or the view closing.
///
/// The first commit after the view is made, or after a crash, opens one and ends nothing.
///
/// A Document doesn't end at a same-document navigation (`pushState`, `replaceState`, a hash change), a sub-frame
/// navigation, a load that never commits (a stop, a download, a 204, a failure), the view leaving the window or the app
/// going to the background.
public enum DocumentEnd {
  /// A main-frame navigation committed while a Document was open: a load, a form submit, back or forward, a reload,
  /// an html source, a `window.open` loaded in place or a back-forward-cache restore.
  case committed
  /// The web content process died.
  ///
  /// The context stays, and the recovery's commit opens the next Document.
  case crashed
  /// The view is unmounting; the hooks' ``WebViewContext/onDestroyed(_:)`` handlers run after it.
  case closing
}

final class DocumentScope {
  private var registrants: [(onEnd: (DocumentEnd) -> Void, skipsOpening: Bool)] = []
  private var open = false

  /// With `skipsOpening`, `onEnd` doesn't hear a commit that opens a Document while none is open.
  func register(skipsOpening: Bool = false, _ onEnd: @escaping (DocumentEnd) -> Void) {
    registrants.append((onEnd, skipsOpening))
  }

  /// Tells every registrant, in registration order.
  func end(_ reason: DocumentEnd) {
    let opening = reason == .committed && !open
    open = reason == .committed
    registrants.forEach { if !(opening && $0.skipsOpening) { $0.onEnd(reason) } }
  }
}
