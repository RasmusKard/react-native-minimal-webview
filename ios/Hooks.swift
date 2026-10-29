import WebKit

/// Native hooks: Swift in your own Expo module that gets the real WKWebView behind each WebView, its creation-time
/// configuration and a `WebViewContext`, with no protocol to implement. A hook attaches to each WebView whose
/// `hookOptions` enables its key (the prop's TSDoc has the rules).
/// Don't touch the WKWebView's own `navigationDelegate` and `uiDelegate` (use the context's lists), or the bridge's
/// script message handler and user scripts.
public enum MinimalWebViewHooks {
  struct Hook {
    let key: String
    /// Where it was registered, `#fileID:#line`: the same place again is a JS reload, not a second hook.
    let site: String
    let webViewClass: WKWebView.Type?
    let configure: ((WKWebViewConfiguration, WebViewContext) -> Void)?
    let attach: (WKWebView, WebViewContext) -> (() -> Void)?
  }

  private(set) static var hooks: [Hook] = []

  /// Registers the hook for `key`; call it from your module's `OnCreate`, before the first WebView. Hooks are
  /// configured and attached in registration order. Keys are global, so prefix yours with your package's name: a
  /// second hook under a key stops the app (`fatalError`, naming the key and both call sites). The same call running
  /// again replaces its hook: a JS reload creates the modules anew, and their `OnCreate` runs again. A helper that
  /// calls `register` for other code is one call site, so a second hook under a key through it replaces the first
  /// silently: pass the helper's caller's `file` and `line` on. `core` is reserved and refused: the package's own
  /// events are named `core.…`.
  /// - Parameters:
  ///   - webViewClass: The WKWebView subclass to make each WebView that enables this hook from, so it can override
  ///     what WKWebView lets it; nil leaves the class to the other hooks. A view whose enabled hooks name different
  ///     classes is made from the first one's, in registration order, and sends a `core.warning` naming the hooks whose
  ///     class it didn't use; those still attach, so check the class `attach` gets. A WebView is never remade for a
  ///     class: when `key` is turned on after the WKWebView was made, this hook doesn't attach, and a warning says so.
  ///     The hidden view `window.open('')` gets is always a plain WKWebView.
  ///   - configure: Runs before the WKWebView exists, with the configuration it is created from: after the
  ///     `ios.configuration` settings and before the bridge, so replacing the user content controller is fine. User
  ///     scripts you add stay, after the package's. It gets the same context that `attach` gets next, so state it
  ///     makes can be keyed by the context. Without it or `webViewClass`, the hook also attaches when its key is
  ///     enabled after the WKWebView was made, after the hooks attached already. `window.open('')` opens a throwaway
  ///     WKWebView from this configuration: your user scripts run in it and your script message handlers get its
  ///     messages, so compare `message.webView` with the WKWebView `attach` gets.
  ///   - attach: Runs once the WKWebView exists and its settings are applied, so what it sets wins over the settings
  ///     the WebView was created with. Returns a closure to run when the view goes away, after
  ///     `onDocumentEnd(.closing)`, or nil. A web content process crash reloads the same WKWebView in place, so nothing
  ///     attaches again and the context and its handlers stay (Android attaches to the replacement WebView).
  ///   - file: With `line`, the call site that tells a reload from a second hook: leave both to their defaults.
  public static func register(
    _ key: String,
    webViewClass: WKWebView.Type? = nil,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> (() -> Void)?,
    file: String = #fileID,
    line: Int = #line
  ) {
    guard key != "core" else { return NSLog("[react-native-minimal-webview] the hook key `core` is reserved: the hook is not registered") }
    let hook = Hook(key: key, site: "\(file):\(line)", webViewClass: webViewClass, configure: configure, attach: attach)
    guard let index = hooks.firstIndex(where: { $0.key == key }) else { return hooks.append(hook) }
    guard hooks[index].site == hook.site else {
      fatalError(
        "[react-native-minimal-webview] two hooks are registered under `\(key)`, at \(hooks[index].site) and \(hook.site): "
          + "prefix yours with your package's name"
      )
    }
    hooks[index] = hook
  }
}

/// Whether a `hookOptions` value enables its hook.
func enables(_ value: Any?) -> Bool {
  guard let value, !(value is NSNull) else { return false }
  // An identity check: `as? Bool` would take an NSNumber 0 for false too.
  return (value as AnyObject) !== kCFBooleanFalse
}

/// One WebView instance, as a hook sees it. Call `emit` and `ask` from any thread and the rest from the main thread,
/// where `configure`, `attach`, the handlers and the answers run. A context kept after the view closed does nothing,
/// and its `ask` answers nil at once.
/// Values from JS arrive as Foundation's JSON types: a number as `NSNumber`, an object as `NSDictionary`, null as nil
/// (`NSNull` inside an array).
/// The context holds the handlers you register (`onOptionsChange`, `onDocumentEnd`, `handle`): an object they capture
/// that also holds the context strongly is a cycle and is never freed, so hold the context weakly.
public protocol WebViewContext: AnyObject {
  /// This hook's `hookOptions` value, the one that enabled it; after a change, the new one.
  var options: Any? { get }
  /// The committed URL, the one `useWebViewState` reports; empty before the first commit. Inside `onDocumentEnd` it
  /// is still the page that ended.
  var url: String { get }
  /// Your navigation delegates, in order. Set them in `attach`: WebKit reads what a delegate responds to when it is
  /// assigned, and the core re-assigns itself after each change to the list.
  /// The navigation action and response policies, decisions the core makes, go to the first delegate that implements
  /// them, and the core steps aside. The action policy goes to the first delegate that implements either of its
  /// variants (with or without `preferences`), and that delegate's own variant is called. A delegate that takes the
  /// action policy decides navigations instead of the navigation rules, which still decide new windows unless a UI
  /// delegate takes `createWebViewWith`. One that takes the response policy switches off `onError`'s `http` errors,
  /// `onDownload` and opening an untaken download externally.
  /// Every other callback the core implements reaches the core, then every delegate that implements it;
  /// `didStartProvisionalNavigation` and `didReceiveServerRedirectForProvisionalNavigation` reach every delegate too.
  /// An authentication challenge goes to each delegate that implements it, in order, until one answers other than
  /// `.performDefaultHandling`, and gets WebKit's default handling when none does. The next delegate gets it only once
  /// the one before has called its completion handler, which each must call exactly once, as WebKit requires.
  /// Any other callback goes only to the first delegate that implements it.
  /// While `onDownload` is set, a delegate whose `didBecome` sets `download.delegate` takes the download from the core,
  /// and `onDownload` gets nothing for it.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  /// Your UI delegates, in order, by the same rules. Their decisions are `createWebViewWith`, the alert, confirm and
  /// prompt panels and the media capture permission; `webViewDidClose` reaches every delegate.
  /// Each callback goes only to the list of the protocol that declares it: a navigation delegate's alert panel or a UI
  /// delegate's action policy is never called.
  /// A delegate that holds a panel's completion handler unanswered should set `webView.accessibilityElementsHidden`
  /// meanwhile, as the core does for its own panels: an accessibility query (XCTest's) into the blocked page hangs.
  var uiDelegates: [WKUIDelegate] { get set }
  /// The control `pullToRefresh` shows: the same one for the view's life, shown or not; nil once the view has closed.
  /// Style it (`tintColor`), but leave its actions and where it is shown to the core.
  var refreshControl: UIRefreshControl? { get }
  /// Sends `onHookEvent({ name: "<key>.<name>", payload })` to JS.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event as `emit` does and calls `onAnswer` with the JS handler's return value, a promise awaited. It
  /// answers nil when the handler throws or there is none, or when the Document ends first; there is no timeout. An
  /// ask made before the first commit (in `attach`, or after a crash) belongs to the Document that commit opens.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
  /// Runs `handler` with this hook's new `hookOptions` value each time it changes, live; nil when the key is removed.
  func onOptionsChange(_ handler: @escaping (Any?) -> Void)
  /// Runs `handler` at each end of the Document (`DocumentScope`), after the core's own resets: per-page state belongs
  /// here.
  func onDocumentEnd(_ handler: @escaping (DocumentScope.End) -> Void)
  /// Answers JS's `ref.hook("<key>", method, args)`: `handler` gets the arguments and calls `reply` exactly once, and
  /// both cross as JSON. One handler per method, the last one wins.
  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: @escaping (Any?) -> Void) -> Void)
}

/// A hook's view of the WebView: the core's context with the hook's key on its events. The view owns it. A hook can
/// outlive the view (an async callback, a detach closure run from its deinit): then the context does nothing.
final class HookContext: WebViewContext {
  let hook: MinimalWebViewHooks.Hook
  private weak var view: MinimalWebView?
  private(set) var options: Any?
  private var optionsHandlers: [(Any?) -> Void] = []
  private var documentEndHandlers: [(DocumentScope.End) -> Void] = []
  private(set) var handlers: [String: ([Any], @escaping (Any?) -> Void) -> Void] = [:]

  init(_ hook: MinimalWebViewHooks.Hook, _ view: MinimalWebView) {
    self.hook = hook
    self.view = view
    options = view.hookOptions[hook.key]
  }

  var key: String { hook.key }

  var url: String { view?.hookUrl ?? "" }

  var navigationDelegates: [WKNavigationDelegate] {
    get { view?.navigationDelegates ?? [] }
    set { view?.navigationDelegates = newValue }
  }

  var uiDelegates: [WKUIDelegate] {
    get { view?.uiDelegates ?? [] }
    set { view?.uiDelegates = newValue }
  }

  var refreshControl: UIRefreshControl? { view?.refreshControl }

  func emit(_ event: String, _ payload: [String: Any]) {
    onMain { [self] in view?.emit("\(key).\(event)", payload) }
  }

  func ask(_ event: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) {
    onMain { [self] in
      guard let view else { return onAnswer(nil) }
      view.asks.ask("\(key).\(event)", payload, onAnswer)
    }
  }

  func onOptionsChange(_ handler: @escaping (Any?) -> Void) {
    optionsHandlers.append(handler)
  }

  func onDocumentEnd(_ handler: @escaping (DocumentScope.End) -> Void) {
    documentEndHandlers.append(handler)
  }

  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: @escaping (Any?) -> Void) -> Void) {
    handlers[method] = handler
  }

  func optionsChanged(_ value: Any?) {
    options = value
    optionsHandlers.forEach { $0(value) }
  }

  func documentEnded(_ reason: DocumentScope.End) {
    documentEndHandlers.forEach { $0(reason) }
  }

  // A hook's own background work (a URLSession completion) may emit or ask; the view's asks are main-thread state.
  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }
}
