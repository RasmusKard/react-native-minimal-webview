package expo.modules.minimalwebview

/**
 * A Document is the main-frame page a WebView shows now: it begins when a navigation commits (a back-forward-cache
 * restore or a failed load's error page too) and ends at the next commit, a renderer crash, or the view closing. The
 * first commit after a WebView is made (at mount or after a crash) opens one and ends nothing. It doesn't end at a
 * same-document or sub-frame navigation, a load that never commits (a stop, a download, a 204), the view leaving the
 * window or the app going to the background. What belongs to it registers here once, and the view reports each end:
 * one scope instead of a reset list per trigger, which disagreed per trigger and per platform. Public for [End], which
 * hooks get.
 */
class DocumentScope internal constructor() {
  /** Why a Document ended. */
  enum class End {
    /**
     * A main-frame navigation committed in the same WebView while a Document was open: a load, a form submit, back or
     * forward, a reload, an html source, a `window.open` loaded in place, a back-forward-cache restore or a failed
     * load's error page. Not a same-document navigation (`pushState`, `replaceState`, a hash change), a sub-frame's,
     * or a load that never commits (a stop, a download, a 204).
     */
    COMMITTED,

    /**
     * The renderer died: this WebView goes, its hooks detach, and they attach again to the one that replaces it,
     * whose first commit opens the next Document.
     */
    CRASHED,

    /** The view is closing: this WebView goes for good, and its hooks detach after this. */
    CLOSING
  }

  private class Registrant(val onEnd: (End) -> Unit, val skipsOpening: Boolean)

  private val registrants = mutableListOf<Registrant>()
  private var open = false

  /** With [skipsOpening], [onEnd] doesn't hear a commit that opens a Document while none is open. */
  internal fun register(skipsOpening: Boolean = false, onEnd: (End) -> Unit) {
    registrants += Registrant(onEnd, skipsOpening)
  }

  /** Tells every registrant, in registration order. */
  internal fun end(reason: End) {
    val opening = reason == End.COMMITTED && !open
    open = reason == End.COMMITTED
    registrants.toList().forEach { if (!(opening && it.skipsOpening)) it.onEnd(reason) }
  }
}
