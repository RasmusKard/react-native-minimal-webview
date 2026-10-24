package expo.modules.minimalwebview

/**
 * A Document is the main-frame page a WebView shows now: it begins when a navigation commits (a back-forward-cache
 * restore or a failed load's error page too) and ends at the next commit, a renderer crash, or the view closing. It
 * doesn't end at a same-document or sub-frame navigation, a load that never commits (a stop, a download, a 204), the
 * view leaving the window or the app going to the background. What belongs to it registers here once, and the view
 * reports each end (docs/decisions.md). Public for [End], which hooks get.
 */
class DocumentScope internal constructor() {
  /** Why a Document ended. */
  enum class End {
    /** A new main-frame page committed in the same WebView. */
    COMMITTED,

    /** The renderer died: this WebView goes, and the hooks attach again to the one that replaces it. */
    CRASHED,

    /** The view is closing: this WebView goes for good. */
    CLOSING
  }

  private val registrants = mutableListOf<(End) -> Unit>()

  internal fun register(onEnd: (End) -> Unit) {
    registrants += onEnd
  }

  /** Tells every registrant, in registration order. */
  internal fun end(reason: End) = registrants.toList().forEach { it(reason) }
}
