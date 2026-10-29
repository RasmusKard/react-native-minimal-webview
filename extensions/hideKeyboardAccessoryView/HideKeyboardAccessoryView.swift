import MinimalWebView
import ObjectiveC
import WebKit

/// The hook behind `hideKeyboardAccessoryView()`. As react-native-webview does, WebKit's private WKContentView
/// (the view that owns the keyboard) gets a runtime subclass whose `inputAccessoryView` is nil, and its own class back
/// when it is switched off or the view goes away. Not the WKWebView's class, which the core observes with KVO.
enum HideKeyboardAccessoryView {
  static let key = "@minimal-rn-webview/extensions.hideKeyboardAccessoryView"
  private static let suffix = "_MinimalWebViewExtensionsNoAccessory"

  static func register() {
    MinimalWebViewHooks.register(key) { webView, context in
      let apply = { [weak webView, weak context] in
        if let content = webView.flatMap(contentView) { hide(content, context?.options as? Bool == true) }
      }
      apply()
      context.onOptionsChange { _ in apply() }
      return { [weak webView] in
        if let content = webView.flatMap(contentView) { hide(content, false) }
      }
    }
  }

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
