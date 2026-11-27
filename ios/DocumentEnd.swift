/// Why a Document ended, as ``WebViewContext/onDocumentEnd(_:)`` and ``WebViewContext/onDestroyed(_:)`` report it.
///
/// A Document is the main-frame page on screen. It lasts from a navigation's commit until the next commit, a renderer
/// crash or the view closing. The first commit after the view is made, or after a crash, opens a Document and ends
/// none.
///
/// These don't end a Document:
/// - a same-document navigation or an iframe's navigation
/// - a load that never commits, such as a stop, a download, a 204 response or a failure
/// - the view leaving the window, or the app going to the background
public enum DocumentEnd {
  /// A main-frame navigation committed while a Document was open. This includes an html source, a `window.open` loaded
  /// in place and a back-forward-cache restore.
  case committed
  /// The renderer died.
  ///
  /// The WKWebView stays and reloads, unless `ProcessGoneEvent.recovered` in JS is false. Nothing attaches again, so
  /// the hooks' contexts, handlers and delegates stay.
  case crashed
  /// The view is closing. The hooks' ``WebViewContext/onDestroyed(_:)`` handlers run after this.
  case closing
}
