package expo.modules.minimalwebview

/**
 * The lifetime of a Document (GLOSSARY.md): what belongs to the main-frame page on screen registers once, and the view
 * reports each end. ADR 0001.
 */
internal class DocumentScope {
  enum class End { COMMITTED, CRASHED, CLOSING }

  private val registrants = mutableListOf<(End) -> Unit>()

  fun register(onEnd: (End) -> Unit) {
    registrants += onEnd
  }

  /** Tells every registrant, in registration order. */
  fun end(reason: End) = registrants.toList().forEach { it(reason) }
}
