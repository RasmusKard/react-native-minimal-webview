import WebKit

/// Native hooks: Swift in your own Expo module that gets the real WKWebView behind each WebView, its creation-time
/// configuration and a ``WebViewContext``, with no protocol to implement.
///
/// The [native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
/// walks through one.
///
/// A hook attaches to each WebView whose `extensions` prop has an extension with its key that is on;
/// [`HookExtension.options`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
/// says when.
///
/// - Important: Leave alone what the core owns: the WKWebView's own `navigationDelegate` and `uiDelegate` (add to the
///   context's lists instead), and the bridge's script message handler and user scripts.
public enum MinimalWebViewHooks {
  struct Hook {
    let key: String
    /// Where it was registered, `#fileID:#line`: the same place again is a JS reload, not a second hook.
    let site: String
    let webViewClass: WKWebView.Type?
    let configure: ((WKWebViewConfiguration, WebViewContext) -> Void)?
    let attach: (WKWebView, WebViewContext) -> Void
  }

  private(set) static var hooks: [Hook] = []

  /// Registers the hook for `key`.
  ///
  /// Call it from your module's `OnCreate`, before the first WebView.
  ///
  /// A second hook under a key stops the app with `fatalError`, naming the key and both call sites. A hook under `core`
  /// is logged and not registered.
  ///
  /// The same call running again replaces its hook: a JS reload creates the modules anew and runs their `OnCreate`
  /// again. A helper that calls `register` for other code is one call site, so a second hook through it replaces the
  /// first silently, unless the helper passes its caller's `file` and `line` on.
  ///
  /// Hooks are configured and attached in registration order, which across packages is autolinking's: packages sorted
  /// by name. A hook whose key turns on after the WebView was created attaches after the hooks attached already.
  ///
  /// - Parameters:
  ///   - key: The key of the app's extension that turns on the hook. Keys are global, so prefix yours with your
  ///     package's name.
  ///   - webViewClass: The WKWebView subclass that each WebView enabling this hook is made from, to override what
  ///     WKWebView lets a subclass override; nil leaves the class to the other hooks. When the enabled hooks name
  ///     different classes, the first one's in registration order makes the view, and a warning names the
  ///     others. Those still attach, so check the class `attach` gets. The hidden view that `window.open('')` gets is
  ///     always a plain WKWebView.
  ///   - configure: Runs before the WKWebView exists, with the configuration it is created from: after the
  ///     `ios.configuration` settings and before the bridge, so replacing the user content controller is fine. User
  ///     scripts you add stay, and run after the package's. It gets the same context that `attach` gets next, so state
  ///     it makes can be keyed by the context. `window.open('')` opens a hidden WKWebView from this configuration: your
  ///     user scripts run in it and your script message handlers get its messages, so compare `message.webView` with
  ///     the WKWebView `attach` gets.
  ///   - attach: Runs once the WKWebView exists and its settings are applied, so what it sets wins over them. Register
  ///     what to run when the view goes away with ``WebViewContext/onDestroyed(_:)``. A web content process crash
  ///     reloads the same WKWebView, so nothing attaches again (see ``DocumentEnd/crashed``).
  ///   - file: With `line`, the call site that tells a reload from a second hook; leave both to their defaults.
  ///   - line: The call site's line, with `file`.
  public static func register(
    _ key: String,
    webViewClass: WKWebView.Type? = nil,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> Void,
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

/// One WebView as one hook sees it, for the life of the WKWebView.
///
/// Call ``emit(_:_:)`` and ``ask(_:_:_:)`` from any thread, and the rest on the main thread, where `configure`,
/// `attach`, the handlers and the answers run.
///
/// A context kept after the view closed does nothing.
///
/// A hook is on while its extension's `options` are not null or false;
/// [`HookExtension.options`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
/// says what off means. ``onOptionsChange(_:)`` still runs while it is off, so the hook can undo what it set up, and
/// again when the hook turns on.
///
/// Values from JS arrive as Foundation's JSON types: a number as `NSNumber`, an object as `NSDictionary`, null as nil
/// (`NSNull` inside an array).
public protocol WebViewContext: AnyObject {
  /// This hook's extension's `options`, the new ones after a change; nil while the hook is off.
  var options: Any? { get }
  /// The committed URL, the one `useWebViewState` reports; empty before the first commit.
  ///
  /// Inside ``onDocumentEnd(_:)`` it is still the page that ended.
  var url: String { get }
  /// Your navigation delegates, in order. While the hook is off, none of them gets a callback.
  ///
  /// WebKit reads which callbacks a delegate implements when it is assigned, so a delegate must implement what it
  /// handles by the time you add it. The core assigns itself again after each change to the list.
  ///
  /// Each callback reaches the delegates by one of these rules:
  /// - A decision, the action or the response policy, goes to the first delegate that implements it, instead of the
  ///   core. Either action policy variant, with or without `preferences`, counts, and that delegate's own variant is
  ///   called.
  /// - The authentication challenge goes to each delegate that implements it, in order, until one answers other than
  ///   `.performDefaultHandling`; when none does, WebKit's default handling. Each must call its completion handler
  ///   exactly once, and the next delegate gets the challenge only after that.
  /// - Every other callback the core implements reaches the core, then each delegate that implements it. So do
  ///   `didStartProvisionalNavigation` and `didReceiveServerRedirectForProvisionalNavigation`.
  /// - Any other callback goes only to the first delegate that implements it.
  ///
  /// Taking a decision switches off what the core decides from the app's props or their defaults, the default
  /// navigation rules' security checks included, and a warning names the callback and what stops applying. A
  /// delegate that takes the action policy decides navigations instead of the navigation rules, which still decide new
  /// windows unless a UI delegate takes `createWebViewWith`.
  ///
  /// A decision more than one delegate implements still goes only to the first, and a warning names it. Each
  /// warning comes once per WebView, when the delegate is added.
  ///
  /// While `onDownload` is set, a delegate whose `didBecome` sets `download.delegate` takes the download, and
  /// `onDownload` gets nothing for it.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  /// Your UI delegates, in order, by the rules of ``navigationDelegates``.
  ///
  /// Their decisions are `createWebViewWith`, the alert, confirm and prompt panels and the media capture permission.
  /// `webViewDidClose` reaches every delegate.
  ///
  /// A callback goes only to the list of the protocol that declares it: a navigation delegate's alert panel, or a UI
  /// delegate's action policy, is never called.
  ///
  /// A delegate that holds a panel's completion handler should set `webView.accessibilityElementsHidden` until it
  /// answers, as the core does for its own panels: an accessibility query (XCTest's) into the blocked page hangs.
  var uiDelegates: [WKUIDelegate] { get set }
  /// The control `pullToRefresh` shows: the same one for the view's life, shown or not; nil once the view has closed.
  ///
  /// Style it (`tintColor`), but leave its actions and where it is shown to the core.
  var refreshControl: UIRefreshControl? { get }
  /// Sends an event to JS: the extension with the hook's key gets `{ name, payload }` in its `onEvent`. It is dropped
  /// while the hook is off, and after the view closed.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event as ``emit(_:_:)`` does, and calls `onAnswer` with the extension's `onEvent` return value, a
  /// promise awaited.
  ///
  /// It answers nil when the handler throws or there is none, or when the Document ends first; there is no timeout. It
  /// answers nil at once while the hook is off, and after the view closed.
  /// An ask made before the first commit (in `attach`, or after a crash) belongs to the Document that commit opens.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
  /// Runs `handler` with this hook's extension's new `options` each time they change, live; nil when the hook turns
  /// off.
  func onOptionsChange(_ handler: @escaping (Any?) -> Void)
  /// Runs `handler` at each end of the Document (see ``DocumentEnd``), after the core's own resets: per-page
  /// state belongs here.
  func onDocumentEnd(_ handler: @escaping (DocumentEnd) -> Void)
  /// Runs `handler` once this view closes, with ``DocumentEnd/closing``, the only reason it gets on iOS.
  ///
  /// It comes after the ``onDocumentEnd(_:)`` handlers that get `closing`. The WKWebView has stopped loading, paused
  /// its media and left the view by then, but is still alive, and the context does nothing.
  ///
  /// Clean up here: what `attach` set up on the WKWebView, such as an observation or a swapped class.
  func onDestroyed(_ handler: @escaping (DocumentEnd) -> Void)
  /// Answers JS's `ref.hook("<key>", method, args)`: `handler` gets the arguments and calls `reply` exactly once, and
  /// both cross as JSON.
  ///
  /// One handler per method: the last one wins. A handler can't fail: a reply JSON can't encode rejects the JS call
  /// with `native_error`. A handler that never replies leaves the call waiting until the view unmounts: a navigation or
  /// a crash doesn't settle it.
  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: @escaping (Any?) -> Void) -> Void)
}

/// A hook's view of the WebView: the core's context with the hook's key on its events. The view owns it. A hook can
/// outlive the view (an async callback): then the context is detached and does nothing.
/// The view routes the delegates of the contexts that are on.
final class HookContext: WebViewContext {
  let hook: MinimalWebViewHooks.Hook
  private weak var view: MinimalWebView?
  /// The `hookOptions` value while the hook is on, nil while it is off.
  private(set) var options: Any?
  private var optionsHandlers: [(Any?) -> Void] = []
  private var documentEndHandlers: [(DocumentEnd) -> Void] = []
  private var destroyedHandlers: [(DocumentEnd) -> Void] = []
  private(set) var handlers: [String: ([Any], @escaping (Any?) -> Void) -> Void] = [:]

  init(_ hook: MinimalWebViewHooks.Hook, _ view: MinimalWebView) {
    self.hook = hook
    self.view = view
    options = view.hookOptions[hook.key]
  }

  /// The view closed: the context keeps nothing of it and nothing the hook gave it, and nothing routes it.
  func detach() {
    view = nil
    navigationDelegates = []
    uiDelegates = []
    optionsHandlers = []
    documentEndHandlers = []
    handlers = [:]
  }

  var key: String { hook.key }

  var url: String { view?.hookUrl ?? "" }

  var isOn: Bool { options != nil }

  var navigationDelegates: [WKNavigationDelegate] = [] {
    didSet { view?.routeDelegates() }
  }

  var uiDelegates: [WKUIDelegate] = [] {
    didSet { view?.routeDelegates() }
  }

  var refreshControl: UIRefreshControl? { view?.refreshControl }

  func emit(_ event: String, _ payload: [String: Any]) {
    onMain { [self] in if isOn { view?.emit(key, event, payload) } }
  }

  func ask(_ event: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) {
    onMain { [self] in
      guard let view, isOn else { return onAnswer(nil) }
      view.asks.ask(key, event, payload, onAnswer)
    }
  }

  func onOptionsChange(_ handler: @escaping (Any?) -> Void) {
    optionsHandlers.append(handler)
  }

  func onDocumentEnd(_ handler: @escaping (DocumentEnd) -> Void) {
    documentEndHandlers.append(handler)
  }

  func onDestroyed(_ handler: @escaping (DocumentEnd) -> Void) {
    destroyedHandlers.append(handler)
  }

  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: @escaping (Any?) -> Void) -> Void) {
    handlers[method] = handler
  }

  func optionsChanged(_ value: Any?) {
    options = value
    view?.routeDelegates()
    optionsHandlers.forEach { $0(options) }
  }

  func documentEnded(_ reason: DocumentEnd) {
    documentEndHandlers.forEach { $0(reason) }
  }

  /// The view closed, and its WKWebView is torn down: the handlers run once, and the context drops them.
  func destroyed() {
    let handlers = destroyedHandlers
    destroyedHandlers = []
    handlers.forEach { $0(.closing) }
  }

  // A hook's own background work (a URLSession completion) may emit or ask; the view's asks are main-thread state.
  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }
}
