import WebKit

/// Native hooks: Swift in your own Expo module that gets the real WKWebView behind each WebView, its creation-time
/// configuration and a `WebViewContext`, with no protocol to implement. A hook attaches to each WebView whose
/// `hookOptions` enables its key (the prop's TSDoc has the rules).
/// Don't touch the WKWebView's own `navigationDelegate` and `uiDelegate` (use the context's lists), or the bridge's
/// script message handler and user scripts.
public enum MinimalWebViewHooks {
  /// The class each WebView is made from; a subclass can override what WKWebView lets it.
  public static var webViewClass: WKWebView.Type = WKWebView.self

  struct Hook {
    let key: String
    /// Where it was registered, `#fileID:#line`: the same place again is a JS reload, not a second hook.
    let site: String
    let configure: ((WKWebViewConfiguration, WebViewContext) -> Void)?
    let attach: (WKWebView, WebViewContext) -> (() -> Void)?
  }

  private(set) static var hooks: [Hook] = []

  /// Registers the hook for `key`; call it from your module's `OnCreate`, before the first WebView. Hooks are
  /// configured and attached in registration order. Keys are global, so prefix yours with your package's name: a
  /// second hook under a key stops the app (`fatalError`, naming the key and both call sites). The same call running
  /// again replaces its hook: a JS reload creates the modules anew, and their `OnCreate` runs again. `core` is reserved
  /// and refused: the package's own events are named `core.…`.
  /// - Parameters:
  ///   - configure: Runs before the WKWebView exists, with the configuration it is created from: after the
  ///     `ios.configuration` settings and before the bridge, so replacing the user content controller is fine. User
  ///     scripts you add stay, after the package's.
  ///   - attach: Runs once the WKWebView exists and its settings are applied, so what it sets wins over the settings
  ///     the WebView was created with. Returns a closure to run when the view goes away, after
  ///     `onDocumentEnd(.closing)`, or nil.
  ///   - file: With `line`, the call site that tells a reload from a second hook: leave both to their defaults.
  public static func register(
    _ key: String,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> (() -> Void)?,
    file: String = #fileID,
    line: Int = #line
  ) {
    guard key != "core" else { return NSLog("[minimal-rn-webview] the hook key `core` is reserved: the hook is not registered") }
    let hook = Hook(key: key, site: "\(file):\(line)", configure: configure, attach: attach)
    guard let index = hooks.firstIndex(where: { $0.key == key }) else { return hooks.append(hook) }
    guard hooks[index].site == hook.site else {
      fatalError(
        "[minimal-rn-webview] two hooks are registered under `\(key)`, at \(hooks[index].site) and \(hook.site): "
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
public protocol WebViewContext: AnyObject {
  /// This hook's `hookOptions` value, the one that enabled it; after a change, the new one.
  var options: Any? { get }
  /// The committed URL, the one `useWebViewState` reports; empty before the first commit. Inside `onDocumentEnd` it
  /// is still the page that ended.
  var url: String { get }
  /// Your navigation delegates, in order. Set them in `attach`: WebKit reads what a delegate responds to when it is
  /// assigned, and the core re-assigns itself after each change to the list.
  /// The navigation action and response policies, decisions the core makes, go to the first delegate that implements
  /// them, and the core steps aside. A delegate that takes the action policy decides navigations instead of the
  /// navigation rules, which still decide new windows unless a UI delegate takes `createWebViewWith`. One that takes
  /// the response policy switches off `onError`'s `http` errors, `onDownload` and opening an untaken download
  /// externally.
  /// Every other callback the core implements reaches the core, then every delegate that implements it;
  /// `didStartProvisionalNavigation` and `didReceiveServerRedirectForProvisionalNavigation` reach every delegate too.
  /// Any other callback (an authentication challenge) goes only to the first delegate that implements it.
  /// While `onDownload` is set, a delegate whose `didBecome` sets `download.delegate` takes the download from the core,
  /// and `onDownload` gets nothing for it.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  /// Your UI delegates, in order, by the same rules. Their decisions are `createWebViewWith`, the alert, confirm and
  /// prompt panels and the media capture permission; `webViewDidClose` reaches every delegate.
  var uiDelegates: [WKUIDelegate] { get set }
  /// Sends `onHookEvent({ name: "<key>.<name>", payload })` to JS.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event as `emit` does and calls `onAnswer` with the JS handler's return value, a promise awaited. It
  /// answers nil when the handler throws or there is none, or when the Document ends first; there is no timeout. An
  /// ask made before the first commit (in `attach`, or after a crash) belongs to the Document that commit opens.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
  /// Runs `handler` with this hook's new `hookOptions` value each time it changes, live; nil when the key is removed.
  /// To switch a hook on and off, keep its key enabled and put the switch in its value (`{ enabled: false }`).
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
