/// Every `ask` (a page request, a navigation request or a hook's) waits here, by id, until JS answers it through
/// `answer` or native gives up (nil, and `core.askCancelled` to JS): a Document end or a timeout. `send` puts an event
/// on the view's `onHookEvent`. Main thread only.
final class Asks {
  private let send: ([String: Any]) -> Void
  private var pending: [Int: (Any?) -> Void] = [:]
  private var nextId = 0

  init(send: @escaping ([String: Any]) -> Void) {
    self.send = send
  }

  /// Sends the ask to JS and returns its id, for `cancel`.
  @discardableResult
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) -> Int {
    nextId += 1
    pending[nextId] = onAnswer
    send(["name": name, "payload": payload, "askId": nextId])
    return nextId
  }

  /// JS's answer. One for an ask that was answered or cancelled already is dropped.
  func answer(_ id: Int, _ value: Any?) {
    pending.removeValue(forKey: id)?(value)
  }

  /// Native gives up on an ask: its callback gets nil, and JS aborts the handler's signal unless `tell` is false.
  func cancel(_ id: Int, tell: Bool = true) {
    guard let onAnswer = pending.removeValue(forKey: id) else { return }
    if tell { send(["name": "core.askCancelled", "payload": ["askId": id]]) }
    onAnswer(nil)
  }

  /// Cancels every pending ask. At closing JS isn't told: it aborts its own handlers at unmount.
  func documentEnded(_ reason: DocumentScope.End) {
    pending.keys.forEach { cancel($0, tell: reason != .closing) }
  }
}
