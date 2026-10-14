import WebKit

/// Native hooks: how an app or a package reaches the WKWebView this package creates, with no protocol to implement.
/// Register them from an Expo module's `OnCreate`, before the first WebView is created. They run on the main thread.
public enum MinimalWebViewHooks {
  /// The class each WebView is made from; a subclass can override what WKWebView lets it.
  public static var webViewClass: WKWebView.Type = WKWebView.self
  /// Runs before the WKWebView exists, with the configuration it is created from: after the `ios.configuration`
  /// settings, before the bridge and the scripts are installed (so replacing the user content controller is fine).
  public static var configure: [(WKWebViewConfiguration, WebViewContext) -> Void] = []
  /// Runs once the WKWebView exists. Return what to run when the view goes away, or nil.
  public static var attach: [(WKWebView, WebViewContext) -> (() -> Void)?] = []
}

/// One WebView instance, as the hooks see it.
public protocol WebViewContext: AnyObject {
  /// The `nativeOptions` prop: whatever the app passed for its hooks.
  var options: [String: Any] { get }
  /// Delegates for the WKWebView, in order. A callback the core doesn't implement goes to the first one that does; a
  /// decision callback the core implements (navigation and response policy, authentication, a new window, a JS dialog,
  /// media capture) goes to the first one that does, and the core steps aside; an observation callback the core
  /// implements (commit, finish, fail, termination, a download starting) reaches the core first, then every one that
  /// does. Set them in `attach`: WebKit reads what a delegate responds to when it is assigned, and the core re-assigns
  /// itself after each change here.
  var navigationDelegates: [WKNavigationDelegate] { get set }
  var uiDelegates: [WKUIDelegate] { get set }
  /// Sends `onNativeEvent({ name, payload })` to JS.
  func emit(_ name: String, _ payload: [String: Any])
  /// Sends the event and waits for JS's answer, the handler's return value; nil when the view or its page goes away.
  func ask(_ name: String, _ payload: [String: Any], _ onAnswer: @escaping (Any?) -> Void)
}
