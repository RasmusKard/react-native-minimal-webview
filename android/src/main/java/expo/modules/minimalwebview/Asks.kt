package expo.modules.minimalwebview

import expo.modules.minimalwebview.DocumentScope.End

/**
 * Every `ask` (a page request, a navigation request or a hook's) waits here, by id, until JS answers it through [answer]
 * or native gives up (null, and `core.askCancelled` to JS): a Document end, a timeout or the platform. [send] puts an
 * event on the view's `onHookEvent`, which reaches the app's extensions' `onEvent`. Main thread only.
 */
internal class Asks(private val send: (Map<String, Any?>) -> Unit) {
  private val pending = mutableMapOf<Int, (Any?) -> Unit>()
  private var nextId = 0
  /** The view closed: JS is unmounted, and a hook may still hold its context. */
  private var closed = false

  /** Sends the ask to JS and returns its id, for [cancel]. Once the view closed it answers null at once. */
  fun ask(name: String, payload: Map<String, Any?>, onAnswer: (Any?) -> Unit): Int {
    if (closed) {
      onAnswer(null)
      return 0 // no ask: cancel(0) finds nothing
    }
    val id = ++nextId
    pending[id] = onAnswer
    send(mapOf("name" to name, "payload" to payload, "askId" to id))
    return id
  }

  /** JS's answer. One for an ask that was answered or cancelled already is dropped. */
  fun answer(id: Int, value: Any?) {
    pending.remove(id)?.invoke(value)
  }

  /** Native gives up on an ask: its callback gets null, and JS aborts the handler's signal unless [tell] is false. */
  fun cancel(id: Int, tell: Boolean = true) {
    val onAnswer = pending.remove(id) ?: return
    if (tell) send(mapOf("name" to "core.askCancelled", "payload" to mapOf("askId" to id)))
    onAnswer(null)
  }

  /** Cancels every pending ask. At closing JS isn't told: it aborts its own handlers at unmount. */
  fun documentEnded(reason: End) {
    if (reason == End.CLOSING) closed = true
    pending.keys.toList().forEach { cancel(it, tell = reason != End.CLOSING) }
  }
}
