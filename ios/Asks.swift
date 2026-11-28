@MainActor
final class Asks {
  private let send: ([String: Any]) -> Void
  private var pending: [Int: (Any?) -> Void] = [:]
  private var nextId = 0
  private var closed = false

  init(send: @escaping ([String: Any]) -> Void) {
    self.send = send
  }

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

  func answer(_ id: Int, _ value: Any?) {
    pending.removeValue(forKey: id)?(value)
  }

  func cancel(_ id: Int, tell: Bool = true) {
    guard let onAnswer = pending.removeValue(forKey: id) else { return }
    if tell { send(["key": "core", "name": "askCancelled", "payload": ["askId": id]]) }
    onAnswer(nil)
  }

  func documentEnded(_ reason: DocumentEnd) {
    if reason == .closing { closed = true }
    pending.keys.forEach { cancel($0, tell: reason != .closing) }
  }
}
