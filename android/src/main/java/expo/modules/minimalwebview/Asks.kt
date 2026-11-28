package expo.modules.minimalwebview

internal class Asks(private val send: (Map<String, Any?>) -> Unit) {
  private val pending = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextId = 0
  private var closed = false

  fun ask(key: String, name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit): Int? {
    if (closed) {
      onAnswer(null)
      return null
    }
    val id = ++nextId
    pending[id] = onAnswer
    send(mapOf("key" to key, "name" to name, "payload" to payload, "askId" to id))
    return id
  }

  fun answer(id: Int, value: Any?) {
    pending.remove(id)?.invoke(value)
  }

  fun cancel(id: Int, tell: Boolean = true) {
    val onAnswer = pending.remove(id) ?: return
    if (tell) send(mapOf("key" to "core", "name" to "askCancelled", "payload" to mapOf("askId" to id)))
    onAnswer(null)
  }

  fun documentEnded(reason: DocumentEnd) {
    if (reason == DocumentEnd.CLOSING) closed = true
    pending.keys.toList().forEach { cancel(it, tell = reason != DocumentEnd.CLOSING) }
  }
}
