/// A Document is the main-frame page on screen, from a navigation's commit (a back-forward-cache restore included) to
/// the next commit, a web content process crash or the view closing. It doesn't end at a same-document or sub-frame
/// navigation, a load that never commits (a stop, a download, a 204, a failure), the view leaving the window or the app
/// going to the background. What belongs to it registers here once, and the view reports each end: one scope instead
/// of a reset list per trigger, which disagreed per trigger and per platform. Public for `End`, which hooks get.
public final class DocumentScope {
  public enum End {
    /// A main-frame navigation committed. A failed load commits nothing, so its Document lives on.
    case committed
    /// The web content process died.
    case crashed
    /// The view is unmounting.
    case closing
  }

  private var registrants: [(End) -> Void] = []

  func register(_ onEnd: @escaping (End) -> Void) {
    registrants.append(onEnd)
  }

  /// Tells every registrant, in registration order.
  func end(_ reason: End) {
    registrants.forEach { $0(reason) }
  }
}
