import MinimalWebView
import ObjectiveC
import WebKit

enum KeyboardDisplayRequiresUserAction {
  static let key = "@react-native-minimal-webview/extensions.keyboardDisplayRequiresUserAction"
  private static let views = NSHashTable<WKWebView>.weakObjects()
  private static let replaced = replaceFocus()

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      guard replaced else { return }
      context.onOptions { [weak webView] options in
        if options != nil { views.add(webView) } else { views.remove(webView) }
      }
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
    // The element's information is a C++ reference, and the activity state changes a 16-bit option set.
    typealias Focus = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Focus.self)
    let focus: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, UInt, AnyObject?) -> Void = {
      view, information, userIsInteracting, blurPreviousNode, activityStateChanges, userObject in
      let interacting = userIsInteracting || views.contains(enclosingWebView(of: view))
      original(view, selector, information, interacting, blurPreviousNode, activityStateChanges, userObject)
    }
    method_setImplementation(method, imp_implementationWithBlock(focus))
    return true
  }

  private static func enclosingWebView(of view: AnyObject) -> WKWebView? {
    var ancestor = (view as? UIView)?.superview
    while let next = ancestor, !(next is WKWebView) { ancestor = next.superview }
    return ancestor as? WKWebView
  }
}
