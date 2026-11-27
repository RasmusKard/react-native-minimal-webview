package expo.modules.minimalwebview

/**
 * Why a Document ended, as [WebViewContext.onDocumentEnd] and [WebViewContext.onDestroyed] report it.
 *
 * A Document is the main-frame page a WebView shows. It lasts from a navigation's commit until the next commit, a
 * renderer crash or the view closing. The first commit after a WebView is made, at mount or after a crash, opens a
 * Document and ends none.
 *
 * These don't end a Document:
 * - a same-document navigation or a sub-frame navigation
 * - a load that never commits, such as a stop, a download or a 204 response
 * - the view leaving the window, or the app going to the background
 */
enum class DocumentEnd {
  /**
   * A main-frame navigation committed in the same WebView while a Document was open. This includes an html source, a
   * `window.open` loaded in place, a back-forward-cache restore and a failed load's error page.
   */
  COMMITTED,

  /**
   * The renderer died, and the core replaces this WebView. Its hooks detach and their [WebViewContext.onDestroyed]
   * handlers run, then the hooks attach again to the new WebView with new contexts.
   */
  CRASHED,

  /** The view is closing. This WebView is destroyed, and its hooks detach after this. */
  CLOSING
}
