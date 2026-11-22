package expo.modules.minimalwebview


/** Main thread only. */
internal class Asks(private val send: (Map<String, Any?>) -> Unit) {
  private val pending = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextId = 0
  private var closed = false

  /** Sends the ask to JS and returns its id, for [cancel]. Once the view closed it answers null at once. */
  fun ask(key: String, name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit): Int {
    if (closed) {
      onAnswer(null)
      return 0
    }
    val id = ++nextId
    pending[id] = onAnswer
    send(mapOf("key" to key, "name" to name, "payload" to payload, "askId" to id))
    return id
  }

  /** JS's answer. One for an ask that was answered or cancelled already is dropped. */
  fun answer(id: Int, value: Any?) {
    pending.remove(id)?.invoke(value)
  }

  /** Native gives up on an ask: its callback gets null, and JS aborts the handler's signal unless [tell] is false. */
  fun cancel(id: Int, tell: Boolean = true) {
    val onAnswer = pending.remove(id) ?: return
    if (tell) send(mapOf("key" to "core", "name" to "askCancelled", "payload" to mapOf("askId" to id)))
    onAnswer(null)
  }

  /** Cancels every pending ask. At closing JS isn't told. */
  fun documentEnded(reason: DocumentEnd) {
    if (reason == DocumentEnd.CLOSING) closed = true
    pending.keys.toList().forEach { cancel(it, tell = reason != DocumentEnd.CLOSING) }
  }
}
