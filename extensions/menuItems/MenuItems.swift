import MinimalWebView
import UIKit
import WebKit

/// The hook behind `menuItems()`; its value is `{ items, suppress }`.
/// The menu needs overrides on the WKWebView itself, so the hook makes its WebViews from `MenuWKWebView`.
enum MenuItems {
  static let key = "@react-native-minimal-webview/extensions.menuItems"

  static func register() {
    MinimalWebViewHooks.register(key, webViewClass: MenuWKWebView.self) { webView, context in
      // Another hook's class won (the core warns): no menu.
      guard let view = webView as? MenuWKWebView else { return }
      context.onOptions { [weak view] options in
        let options = options as? [String: Any]
        view?.menuItems = options?["items"] as? [[String: Any]]
        view?.suppressMenuItems = Set(options?["suppress"] as? [String] ?? [])
      }
      view.onMenuItem = { [weak view] key in
        guard let view else { return }
        let label = view.menuItems?.first { $0["key"] as? String == key }?["label"] ?? ""
        // As react-native-webview: the main frame's selection.
        view.evaluateJavaScript("window.getSelection().toString()") { result, _ in
          context.emit("selection", ["key": key, "label": label, "selectedText": result as? String ?? ""])
        }
      }
    }
  }
}

/// A WKWebView whose selection menu shows `menuItems` instead of the system's items, and hides `suppressMenuItems`.
final class MenuWKWebView: WKWebView {
  /// react-native-webview's `{ key, label }` items; nil leaves the system's menu.
  var menuItems: [[String: Any]]?
  /// react-native-webview's names for the system items to hide (`copy`, `lookup`, …).
  var suppressMenuItems: Set<String> = []
  var onMenuItem: ((String) -> Void)?

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(minimalWebViewExtensionsMenuItem(_:)) { return menuItems != nil }
    let name = NSStringFromSelector(action)
    if suppressMenuItems.contains(Self.names[name] ?? name) { return false }
    return menuItems == nil && super.canPerformAction(action, withSender: sender)
  }

  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    guard let menuItems, builder.system == .context, builder.menu(for: .root) != nil else { return }
    builder.remove(menu: .lookup)
    let commands = menuItems.map {
      UICommand(
        title: $0["label"] as? String ?? "", action: #selector(minimalWebViewExtensionsMenuItem(_:)),
        propertyList: $0["key"] as? String ?? ""
      )
    }
    builder.insertChild(UIMenu(options: .displayInline, children: commands), atStartOfMenu: .root)
  }

  @objc func minimalWebViewExtensionsMenuItem(_ sender: UICommand) {
    onMenuItem?(sender.propertyList as? String ?? "")
  }

  /// react-native-webview's `suppressMenuItems` names, by the system item's selector.
  private static let names = [
    "cut:": "cut", "copy:": "copy", "paste:": "paste", "select:": "select", "selectAll:": "selectAll",
    "_promptForReplace:": "replace", "_define:": "lookup", "_translate:": "translate", "toggleBoldface:": "bold",
    "toggleItalics:": "italic", "toggleUnderline:": "underline", "_share:": "share"
  ]
}
