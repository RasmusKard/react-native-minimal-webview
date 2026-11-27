import WebKit

/// Registers native hooks. A native hook is Swift in your own Expo module that gets the real WKWebView behind each
/// `<WebView>`, the configuration it is created from, and a ``WebViewContext``.
///
/// A hook attaches to each WebView whose `extensions` prop holds an extension with its key that is on.
/// [`HookExtension.options`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
/// says when an extension is on.
///
/// - Important: Leave alone what the core owns: the WKWebView's own `navigationDelegate` and `uiDelegate`, and the
///   bridge's script message handler and user scripts. Add your delegates to the context's lists instead.
///
/// ## See Also
/// - [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
public enum MinimalWebViewHooks {
  struct Hook {
    let key: String
    let webViewClass: WKWebView.Type?
    let configure: ((WKWebViewConfiguration, WebViewContext) -> Void)?
    let attach: (WKWebView, WebViewContext) -> Void
  }

  private(set) static var hooks: [Hook] = []

  /// Registers the hook for `key`. Call it from your module's `OnCreate`, before the first WebView.
  ///
  /// Registering a key that is taken replaces the earlier hook in its place and logs a warning. A hook under `core` is
  /// logged and not registered.
  ///
  /// Hooks are configured and attached in registration order. Across packages, that order is autolinking's. A hook
  /// whose key turns on after the WebView was created attaches after the hooks attached already.
  ///
  /// - Parameters:
  ///   - key: The key of the extension that turns the hook on. Every package shares one set of keys, so prefix yours
  ///     with your package's name.
  ///   - webViewClass: The WKWebView subclass that the core creates for each WebView this hook attaches to. Nil leaves
  ///     the class to the other hooks. When the attached hooks pass different classes, the first in registration order
  ///     makes the view and a warning names the others. Those hooks still attach, so check the class that `attach`
  ///     gets. The hidden view that `window.open('')` gets is always a plain WKWebView.
  ///   - configure: Runs before the WKWebView exists, with the configuration it is created from. It runs after the
  ///     `ios.configuration` settings and before the bridge, so you may replace the user content controller. User
  ///     scripts you add stay, and run after the package's. It gets the same context that `attach` gets next, so you
  ///     can key state by the context. `window.open('')` opens a hidden WKWebView from this configuration. Your user
  ///     scripts run in it and your script message handlers get its messages, so compare `message.webView` with the
  ///     WKWebView that `attach` gets.
  ///   - attach: Runs once the WKWebView exists and its settings are applied, so what it sets overrides them. Register
  ///     cleanup with ``WebViewContext/onDestroyed(_:)``. A renderer crash reloads the same WKWebView, so nothing
  ///     attaches again (see ``DocumentEnd/crashed``).
  public static func register(
    _ key: String,
    webViewClass: WKWebView.Type? = nil,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> Void
  ) {
    guard key != "core" else { return NSLog("[react-native-minimal-webview] the hook key `core` is reserved: the hook is not registered") }
    let hook = Hook(key: key, webViewClass: webViewClass, configure: configure, attach: attach)
    guard let index = hooks.firstIndex(where: { $0.key == key }) else { return hooks.append(hook) }
    NSLog(
      "%@",
      "[react-native-minimal-webview] a hook under `\(key)` replaces the one registered before: a JS reload registers "
        + "every hook again; otherwise two hooks share the key and the last one wins, so prefix yours with your package's name"
    )
    hooks[index] = hook
  }

  /// Deprecated: `file` and `line` do nothing. Use ``register(_:webViewClass:configure:attach:)``.
  @available(*, deprecated, message: "file: and line: do nothing; drop them")
  public static func register(
    _ key: String,
    webViewClass: WKWebView.Type? = nil,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> Void,
    file: String = #fileID,
    line: Int = #line
  ) {
    register(key, webViewClass: webViewClass, configure: configure, attach: attach)
  }
}

/// A hook's view of one WebView, for the life of the WKWebView.
///
/// Call ``emit(_:_:)`` and ``ask(_:_:_:)`` from any thread, and the other members on the main thread, where
/// `configure`, `attach`, the handlers and the answers run.
///
/// A context kept after the view closed does nothing.
///
/// [`HookExtension.options`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/#options)
/// says when the hook is on.
///
/// Values from JS arrive as Foundation's JSON types: a number as `NSNumber`, an object as `NSDictionary`, an array as
/// `NSArray`. In an ask's answer and a ``handle(_:_:)`` handler's arguments, null is nil at the top level and `NSNull`
/// inside an array or object.
///
/// ## See Also
/// - [Native hooks guide](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/)
public protocol WebViewContext: AnyObject {
  /// This hook's extension's current `options`, or nil while the hook is off.
  var options: Any? { get }
  /// The committed URL, the one `useWebViewState` reports. It is empty before the first commit.
  ///
  /// Inside ``onDocumentEnd(_:)`` it is still the page that ended.
  var url: String { get }
  /// Your navigation delegates, in order. While the hook is off, none of them gets a callback.
  ///
  /// A delegate must implement every callback it handles by the time you add it.
  ///
  /// Each callback reaches the delegates by one of these rules:
  /// - A decision, which is the action policy or the response policy, goes to the first delegate that implements it,
  ///   instead of the core. Either action policy variant counts, with or without `preferences`, and that delegate's
  ///   own variant is called.
  /// - The authentication challenge goes to each delegate that implements it, in order, until one answers with
  ///   something other than `.performDefaultHandling`. Each delegate must call its completion handler exactly once,
  ///   and the next delegate gets the challenge only after that. When none answers otherwise, the core answers
  ///   `.performDefaultHandling`, or `.rejectProtectionSpace` once the site has rejected a credential, so that the
  ///   site's 401 page loads.
  /// - Every other callback the core implements reaches the core, then each delegate that implements it.
  /// - `didStartProvisionalNavigation` and `didReceiveServerRedirectForProvisionalNavigation` reach each delegate that
  ///   implements them.
  /// - Any other callback goes only to the first delegate that implements it.
  ///
  /// A delegate that takes a decision the core makes from the app's props or their defaults switches those off,
  /// including the default navigation rules' security checks. A warning names the callback and what stops applying.
  ///
  /// A delegate that takes the action policy decides navigations instead of the navigation rules. The rules still
  /// decide new windows unless a UI delegate takes `createWebViewWith`. A new window the rules allow loads in place,
  /// and that load reaches the delegate that takes the action policy.
  ///
  /// When more than one delegate implements a decision, only the first gets it, and a warning names the callback. Each
  /// warning comes once per WebView, when the delegate is added.
  ///
  /// While `onDownload` is set, a delegate whose `didBecome` sets `download.delegate` takes the download, and
  /// `onDownload` gets nothing for it.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  /// Your UI delegates, in order, routed by the rules of ``navigationDelegates``.
  ///
  /// Their decisions are `createWebViewWith`, the alert, confirm and prompt panels, and the media capture permission.
  /// `webViewDidClose` reaches every delegate.
  ///
  /// A callback goes only to the list of the protocol that declares it. A navigation delegate's alert panel, or a UI
  /// delegate's action policy, is never called.
  ///
  /// A delegate that holds a panel's completion handler should set `webView.accessibilityElementsHidden` until it
  /// answers. Otherwise an accessibility query into the blocked page, such as XCTest's, hangs.
  var uiDelegates: [WKUIDelegate] { get set }
  /// The control that `pullToRefresh` shows. It is the same control for the view's life, shown or not, and nil once
  /// the view has closed.
  ///
  /// You may style it, such as its `tintColor`, but leave its actions and where it is shown to the core.
  var refreshControl: UIRefreshControl? { get }
  /// Sends an event to JS. The extension with this hook's key gets `{ name, payload }` in its `onEvent`. The event is
  /// dropped while the hook is off.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event as ``emit(_:_:)`` does, but to the extension's `onAsk` when it has one, and calls `onAnswer` with
  /// the handler's return value. A promise it returns is awaited.
  ///
  /// `onAnswer` gets nil when the handler throws, when there is no handler, or when the Document ends first. There is
  /// no timeout. It gets nil at once while the hook is off and after the view closed. An ask made before the first
  /// commit, as in `attach` or after a crash, belongs to the Document that commit opens.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
  /// Runs `handler` at once with this hook's extension's `options`, then with the new options each time they change,
  /// on the same view. It gets nil when the hook turns off, so it can undo what it set up.
  ///
  /// A change from one off value to another doesn't run it.
  func onOptions(_ handler: @escaping (_ options: Any?) -> Void)
  /// Runs `handler` each time the Document ends, after the core has reset its own per-page state. Reset your per-page
  /// state here.
  func onDocumentEnd(_ handler: @escaping (DocumentEnd) -> Void)
  /// Runs `handler` once this view closes, with ``DocumentEnd/closing``, the only reason it gets on iOS.
  ///
  /// It runs after the ``onDocumentEnd(_:)`` handlers that get `closing`, and the context does nothing by then. The
  /// WKWebView is still alive, but it has stopped loading, paused its media, lost every script message handler,
  /// yours included, and left the view.
  ///
  /// Clean up here what `attach` set up on the WKWebView, such as an observation or a swapped class.
  func onDestroyed(_ handler: @escaping (DocumentEnd) -> Void)
  /// Answers JS's `ref.hook("<key>", method, args)` for `method`. `handler` gets the arguments and a ``HookReply``,
  /// which it calls with the reply or fails, at once or later. A later handler for the same method replaces the earlier
  /// one.
  ///
  /// A handler that never replies leaves the call pending until the view unmounts. A navigation or a crash doesn't
  /// settle it.
  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: HookReply) -> Void)
}

/// The reply to one JS `ref.hook` call, which a ``WebViewContext/handle(_:_:)`` handler gets. Call it with the value
/// the call resolves with, or ``fail(_:)`` it.
///
/// Only the first reply or fail counts, and any later one does nothing. Call it from any thread.
public final class HookReply {
  private let resolve: (Any?) -> Void
  private let reject: (String) -> Void
  private let lock = NSLock()
  private var settled = false

  init(resolve: @escaping (Any?) -> Void, reject: @escaping (String) -> Void) {
    self.resolve = resolve
    self.reject = reject
  }

  /// Resolves the JS call with `value`, converted as [`ref.call`'s results](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#call) are;
  /// a non-finite number rejects the call with `native_error` instead.
  public func callAsFunction(_ value: Any?) {
    if first() { resolve(value) }
  }

  /// Rejects the JS call with `handler_error` and `message`.
  public func fail(_ message: String) {
    if first() { reject(message) }
  }

  private func first() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let first = !settled
    settled = true
    return first
  }
}

final class HookContext: WebViewContext {
  let hook: MinimalWebViewHooks.Hook
  private weak var view: MinimalWebView?
  private(set) var options: Any?
  private var optionsHandlers: [(Any?) -> Void] = []
  private var documentEndHandlers: [(DocumentEnd) -> Void] = []
  private var destroyedHandlers: [(DocumentEnd) -> Void] = []
  private(set) var handlers: [String: ([Any], HookReply) -> Void] = [:]

  init(_ hook: MinimalWebViewHooks.Hook, _ view: MinimalWebView) {
    self.hook = hook
    self.view = view
    options = view.hookOptions[hook.key]
  }

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

  func onOptions(_ handler: @escaping (_ options: Any?) -> Void) {
    guard view != nil else { return }
    optionsHandlers.append(handler)
    handler(options)
  }

  func onDocumentEnd(_ handler: @escaping (DocumentEnd) -> Void) {
    documentEndHandlers.append(handler)
  }

  func onDestroyed(_ handler: @escaping (DocumentEnd) -> Void) {
    destroyedHandlers.append(handler)
  }

  func handle(_ method: String, _ handler: @escaping (_ args: [Any], _ reply: HookReply) -> Void) {
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

  func destroyed() {
    let handlers = destroyedHandlers
    destroyedHandlers = []
    handlers.forEach { $0(.closing) }
  }

  private func onMain(_ block: @escaping @MainActor () -> Void) {
    if Thread.isMainThread { MainActor.assumeIsolated(block) } else { DispatchQueue.main.async(execute: block) }
  }
}
