import MinimalWebView
import ObjectiveC
import WebKit

enum HideKeyboardAccessoryView {
  static let key = "@react-native-minimal-webview/extensions.hideKeyboardAccessoryView"
  // Objective-C class names are app-wide, and `#fileID` starts with the module name.
  private static let suffix = "_\(#fileID.prefix { $0 != "/" })NoAccessory"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      context.onOptions { [weak webView] options in
        if let content = webView.flatMap(contentView) { hide(content, options != nil) }
      }
      context.onDestroyed { [weak webView] _ in
        if let content = webView.flatMap(contentView) { hide(content, false) }
      }
    }
  }

  // WKContentView owns the keyboard. KVO swaps an observed WKWebView's class too.
  private static func contentView(_ webView: WKWebView) -> UIView? {
    webView.scrollView.subviews.first { object_getClass($0).map(NSStringFromClass)?.hasPrefix("WKContent") == true }
  }

  private static func hide(_ view: UIView, _ hidden: Bool) {
    guard let current = object_getClass(view) else { return }
    let name = NSStringFromClass(current)
    guard hidden != name.hasSuffix(suffix) else { return }
    let target: AnyClass? =
      hidden ? NSClassFromString(name + suffix) ?? makeSubclass(of: current, named: name + suffix) : class_getSuperclass(current)
    if let target { _ = object_setClass(view, target) }
  }

  private static func makeSubclass(of base: AnyClass, named name: String) -> AnyClass? {
    let getter = #selector(getter: UIResponder.inputAccessoryView)
    guard let subclass = objc_allocateClassPair(base, name, 0), let method = class_getInstanceMethod(base, getter) else {
      return nil
    }
    let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
    class_addMethod(subclass, getter, imp_implementationWithBlock(none), method_getTypeEncoding(method))
    objc_registerClassPair(subclass)
    return subclass
  }
}
