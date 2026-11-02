package expo.modules.minimalwebview

/**
 * Why a Document ended, as [WebViewContext.onDocumentEnd] and [WebViewContext.onDestroyed] report it.
 *
 * A Document is the main-frame page a WebView shows now: from a navigation's commit, a back-forward-cache restore or a
 * failed load's error page included, to the next commit, a renderer crash or the view closing.
 *
 * The first commit after a WebView is made, at mount or after a crash, opens one and ends nothing.
 *
 * A Document doesn't end at a same-document navigation (`pushState`, `replaceState`, a hash change), a sub-frame
 * navigation, a load that never commits (a stop, a download, a 204), the view leaving the window or the app going to
 * the background.
 */
enum class DocumentEnd {
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
