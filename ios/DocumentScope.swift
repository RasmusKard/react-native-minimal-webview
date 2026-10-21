/// The lifetime of a Document (GLOSSARY.md): what belongs to the main-frame page on screen registers once, and the view
/// reports each end. ADR 0001. Public for `End`, which hooks get.
public final class DocumentScope {
  public enum End { case committed, crashed, closing }

  private var registrants: [(End) -> Void] = []

  func register(_ onEnd: @escaping (End) -> Void) {
    registrants.append(onEnd)
  }

  /// Tells every registrant, in registration order.
  func end(_ reason: End) {
    registrants.forEach { $0(reason) }
  }
}
