package expo.modules.minimalwebview

internal class DocumentScope {
  private class Registrant(val onEnd: (DocumentEnd) -> Unit, val skipsOpening: Boolean)

  private val registrants = mutableListOf<Registrant>()
  private var open = false

  /** With [skipsOpening], [onEnd] doesn't hear a commit that opens a Document while none is open. */
  fun register(skipsOpening: Boolean = false, onEnd: (DocumentEnd) -> Unit) {
    registrants += Registrant(onEnd, skipsOpening)
  }

  /** Tells every registrant, in registration order. */
  fun end(reason: DocumentEnd) {
    val opening = reason == DocumentEnd.COMMITTED && !open
    open = reason == DocumentEnd.COMMITTED
    registrants.toList().forEach { if (!(opening && it.skipsOpening)) it.onEnd(reason) }
  }
}
