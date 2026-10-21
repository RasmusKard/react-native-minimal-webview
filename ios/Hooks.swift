import WebKit

/// Native hooks: how an app or a package reaches the WKWebView this package creates, with no protocol to implement.
/// A hook is registered under the `nativeOptions` key that enables it, from an Expo module's `OnCreate` (before the
/// first WebView is created), and runs for each WebView created with a value for that key other than null or false,
/// on the main thread. docs/native-hooks.md has the rules for the delegates and the events.
public enum MinimalWebViewHooks {
  /// The class each WebView is made from; a subclass can override what WKWebView lets it.
  public static var webViewClass: WKWebView.Type = WKWebView.self

  struct Hook {
    let key: String
    let configure: ((WKWebViewConfiguration, WebViewContext) -> Void)?
    let attach: (WKWebView, WebViewContext) -> (() -> Void)?
  }

  /// In registration order: the order the hooks are configured and attached in, so which delegate comes first.
  private(set) static var hooks: [Hook] = []

  /// Registers the hook for `key`. `configure` runs before the WKWebView exists, with the configuration it is created
  /// from: after the `ios.configuration` settings, before the bridge and the scripts are installed (so replacing the
  /// user content controller is fine). `attach` runs once the WKWebView exists and the live `ios` settings are applied,
  /// and returns what to run when the view goes away, or nil. A second registration under a key replaces the first,
  /// with a warning.
  public static func register(
    _ key: String,
    configure: ((WKWebViewConfiguration, WebViewContext) -> Void)? = nil,
    attach: @escaping (WKWebView, WebViewContext) -> (() -> Void)?
  ) {
    // The package's own events are `core.…`: a hook under it would have its events taken for them.
    guard key != "core" else { return NSLog("[react-native-minimal-webview] the hook key `core` is reserved: the hook is not registered") }
    let hook = Hook(key: key, configure: configure, attach: attach)
    if let index = hooks.firstIndex(where: { $0.key == key }) {
      NSLog("[react-native-minimal-webview] a second hook registered under `%@` replaces the first", key)
      hooks[index] = hook
    } else {
      hooks.append(hook)
    }
  }
}

/// Whether a `nativeOptions` value enables its hook.
func enables(_ value: Any?) -> Bool {
  guard let value, !(value is NSNull) else { return false }
  // An identity check: `as? Bool` would take an NSNumber 0 for false too.
  return (value as AnyObject) !== kCFBooleanFalse
}

/// One WebView instance, as a hook sees it.
public protocol WebViewContext: AnyObject {
  /// This hook's `nativeOptions` value; after a change, the new one.
  var options: Any? { get }
  /// The committed URL, the one the navigation state reports; empty before the first commit.
  var url: String { get }
  /// Delegates for the WKWebView, in order; set them in `attach`. A callback goes to the core, to the first delegate
  /// that responds, or to every one, by the rule in docs/native-hooks.md.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  var uiDelegates: [WKUIDelegate] { get set }
  /// Sends `onNativeEvent({ name: "<hook>.<name>", payload })` to JS.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event and waits for JS's answer, the handler's return value; nil when the view or its page goes away.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
  /// Runs `handler` with this hook's new `nativeOptions` value each time it changes; nil when the key is removed.
  func onOptionsChange(_ handler: @escaping (Any?) -> Void)
  /// Runs `handler` at each end of the Document (GLOSSARY.md): a new page committed, a crash, or the view closing.
  func onDocumentEnd(_ handler: @escaping (DocumentScope.End) -> Void)
  /// Answers JS's `ref.hook("<hook>", method, args)`. `handler` gets the arguments as the platform's JSON types and
  /// calls `reply` once, with a value JSON can encode. A later handler for the same method replaces this one.
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
    options = view.nativeOptions[hook.key]
  }

  var key: String { hook.key }

  var url: String { view?.url ?? "" }

  var navigationDelegates: [WKNavigationDelegate] {
    get { view?.navigationDelegates ?? [] }
    set { view?.navigationDelegates = newValue }
  }

  var uiDelegates: [WKUIDelegate] {
    get { view?.uiDelegates ?? [] }
    set { view?.uiDelegates = newValue }
  }

  func emit(_ event: String, _ payload: [String: Any]) {
    view?.emit("\(key).\(event)", payload)
  }

  func ask(_ event: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) {
    guard let view else { return onAnswer(nil) }
    view.ask("\(key).\(event)", payload, onAnswer)
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
}
