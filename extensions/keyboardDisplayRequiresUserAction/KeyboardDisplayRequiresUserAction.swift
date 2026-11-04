import MinimalWebView
import ObjectiveC
import WebKit

/// The hook behind `keyboardDisplayRequiresUserAction()`. As react-native-webview does, it replaces the private
/// WKContentView method that starts the keyboard for a focused element, so that a script's focus counts as the user's.
/// Once per process, on WKContentView itself, for the WebViews in `views`: not the instance's class, which
/// hideKeyboardAccessoryView swaps for a runtime subclass of it.
enum KeyboardDisplayRequiresUserAction {
  static let key = "@react-native-minimal-webview/extensions.keyboardDisplayRequiresUserAction"
  /// The WebViews the hook is on for.
  private static let views = NSHashTable<WKWebView>.weakObjects()
  private static let replaced = replaceFocus()

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      guard replaced else { return }
      let apply = { [weak webView] in
        if context.options != nil { views.add(webView) } else { views.remove(webView) }
      }
      apply()
      context.onOptionsChange { _ in apply() }
      context.onDestroyed { [weak webView] _ in views.remove(webView) }
    }
  }

  private static func replaceFocus() -> Bool {
    let selector = NSSelectorFromString(
      "_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:"
    )
    guard let method = NSClassFromString("WKContentView").flatMap({ class_getInstanceMethod($0, selector) }) else {
      NSLog("[@react-native-minimal-webview/extensions] keyboardDisplayRequiresUserAction: this iOS has no WKContentView method to replace, so it does nothing")
      return false
    }
    // The element's information is a C++ reference, and the activity state changes a 16-bit option set: passed on as
    // they came.
    typealias Focus = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Focus.self)
    let focus: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void = {
      view, information, userIsInteracting, blurPreviousNode, activityStateChanges, userObject in
      // The content view is inside its WKWebView's scroll view.
      var ancestor = (view as? UIView)?.superview
      while let next = ancestor, !(next is WKWebView) { ancestor = next.superview }
      let interacting = userIsInteracting || views.contains(ancestor as? WKWebView)
      original(view, selector, information, interacting, blurPreviousNode, activityStateChanges, userObject)
    }
    method_setImplementation(method, imp_implementationWithBlock(focus))
    return true
  }
}
