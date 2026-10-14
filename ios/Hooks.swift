import WebKit

/// Native hooks: how an app or a package reaches the WKWebView this package creates, with no protocol to implement.
/// A hook is registered under the `nativeOptions` key that enables it, from an Expo module's `OnCreate` (before the
/// first WebView is created), and runs for each WebView whose `nativeOptions` has that key, on the main thread.
/// README "Native hooks" has the rules for the delegates and the events.
public enum MinimalWebViewHooks {
  /// The class each WebView is made from; a subclass can override what WKWebView lets it.
  public static var webViewClass: WKWebView.Type = WKWebView.self
  /// Runs before the WKWebView exists, with the configuration it is created from: after the `ios.configuration`
  /// settings, before the bridge and the scripts are installed (so replacing the user content controller is fine).
  public static var configure: [String: (WKWebViewConfiguration, WebViewContext) -> Void] = [:]
  /// Runs once the WKWebView exists. Return what to run when the view goes away, or nil.
  public static var attach: [String: (WKWebView, WebViewContext) -> (() -> Void)?] = [:]
}

/// One WebView instance, as a hook sees it.
public protocol WebViewContext: AnyObject {
  /// The `nativeOptions` prop: whatever the app passed for its hooks.
  var options: [String: Any] { get }
  /// Delegates for the WKWebView, in order; set them in `attach`. A callback goes to the core, to the first delegate
  /// that responds, or to every one, by the rules in README "Native hooks".
  var navigationDelegates: [WKNavigationDelegate] { get set }
  var uiDelegates: [WKUIDelegate] { get set }
  /// Sends `onNativeEvent({ name: "<hook>.<name>", payload })` to JS.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event and waits for JS's answer, the handler's return value; nil when the view or its page goes away.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
}

/// A hook's view of the WebView: the core's context with the hook's name on its events. The view owns it.
final class HookContext: WebViewContext {
  private let name: String
  private unowned let view: MinimalWebView

  init(_ name: String, _ view: MinimalWebView) {
    self.name = name
    self.view = view
  }

  var options: [String: Any] { view.options }

  var navigationDelegates: [WKNavigationDelegate] {
    get { view.navigationDelegates }
    set { view.navigationDelegates = newValue }
  }

  var uiDelegates: [WKUIDelegate] {
    get { view.uiDelegates }
    set { view.uiDelegates = newValue }
  }

  func emit(_ event: String, _ payload: [String: Any]) {
    view.emit("\(name).\(event)", payload)
  }

  func ask(_ event: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void) {
    view.ask("\(name).\(event)", payload, onAnswer)
  }
}
