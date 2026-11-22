@MainActor
final class Asks {
  private let send: ([String: Any]) -> Void
  private var pending: [Int: (Any?) -> Void] = [:]
  private var nextId = 0
  private var closed = false

  init(send: @escaping ([String: Any]) -> Void) {
    self.send = send
  }

  /// Sends the ask to JS and returns its id, for `cancel`. Once the view closed it answers nil at once and returns nil.
  @discardableResult
  func ask(_ key: String, _ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) -> Int? {
    guard !closed else {
      onAnswer(nil)
      return nil
    }
    nextId += 1
    pending[nextId] = onAnswer
    send(["key": key, "name": name, "payload": payload, "askId": nextId])
    return nextId
  }

  /// An answer for an ask that was answered or cancelled already is dropped.
  func answer(_ id: Int, _ value: Any?) {
    pending.removeValue(forKey: id)?(value)
  }

  /// Native gives up on an ask: its callback gets nil, and JS aborts the handler's signal unless `tell` is false.
  func cancel(_ id: Int, tell: Bool = true) {
    guard let onAnswer = pending.removeValue(forKey: id) else { return }
    if tell { send(["key": "core", "name": "askCancelled", "payload": ["askId": id]]) }
    onAnswer(nil)
  }

  /// Cancels every pending ask, telling JS unless the view is closing.
  func documentEnded(_ reason: DocumentEnd) {
    if reason == .closing { closed = true }
    pending.keys.forEach { cancel($0, tell: reason != .closing) }
  }
}
