package expo.modules.minimalwebview

/**
 * A Document is the main-frame page a WebView shows now: from a navigation's commit, a back-forward-cache restore or a
 * failed load's error page included, to the next commit, a renderer crash or the view closing. A hook hears each end
 * in [WebViewContext.onDocumentEnd].
 *
 * The first commit after a WebView is made, at mount or after a crash, opens one and ends nothing.
 *
 * A Document doesn't end at a same-document navigation (`pushState`, `replaceState`, a hash change), a sub-frame
 * navigation, a load that never commits (a stop, a download, a 204), the view leaving the window or the app going to
 * the background.
 */
class DocumentScope internal constructor() {
  /** Why a Document ended. */
  enum class End {
    /**
     * A main-frame navigation committed in the same WebView while a Document was open: a load, a form submit, back or
     * forward, a reload, an html source, a `window.open` loaded in place, a back-forward-cache restore or a failed
     * load's error page.
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
