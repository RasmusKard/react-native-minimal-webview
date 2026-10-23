package expo.modules.minimalwebview

/**
 * The lifetime of a Document (docs/glossary.md): what belongs to the main-frame page on screen registers once, and the view
 * reports each end (docs/decisions.md). Public for [End], which hooks get.
 */
class DocumentScope internal constructor() {
  enum class End { COMMITTED, CRASHED, CLOSING }

  private val registrants = mutableListOf<(End) -> Unit>()

  internal fun register(onEnd: (End) -> Unit) {
    registrants += onEnd
  }

  /** Tells every registrant, in registration order. */
  internal fun end(reason: End) = registrants.toList().forEach { it(reason) }
}
