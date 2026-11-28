import MinimalWebView
import UIKit
import WebKit

/// The menu needs overrides on the WKWebView itself.
enum MenuItems {
  static let key = "@react-native-minimal-webview/extensions.menuItems"

  static func register() {
    MinimalWebViewHooks.register(key, webViewClass: MenuWKWebView.self) { webView, context in
      guard let view = webView as? MenuWKWebView else { return }
      context.onOptions { [weak view] options in
        let options = options as? [String: Any]
        view?.menuItems = options?["items"] as? [[String: Any]]
        view?.suppressMenuItems = Set(options?["suppress"] as? [String] ?? [])
      }
      view.onMenuItem = { [weak view] key in
        guard let view else { return }
        let label = view.menuItems?.first { $0["key"] as? String == key }?["label"] ?? ""
        view.evaluateJavaScript("window.getSelection().toString()") { result, _ in
          context.emit("selection", ["key": key, "label": label, "selectedText": result as? String ?? ""])
        }
      }
    }
  }
}

final class MenuWKWebView: WKWebView {
  var menuItems: [[String: Any]]?
  var suppressMenuItems: Set<String> = []
  var onMenuItem: ((String) -> Void)?

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(minimalWebViewExtensionsMenuItem(_:)) { return menuItems != nil }
    let name = NSStringFromSelector(action)
    if suppressMenuItems.contains(Self.suppressNameBySelector[name] ?? name) { return false }
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

  private static let suppressNameBySelector = [
    "cut:": "cut", "copy:": "copy", "paste:": "paste", "select:": "select", "selectAll:": "selectAll",
    "_promptForReplace:": "replace", "_define:": "lookup", "_translate:": "translate", "toggleBoldface:": "bold",
    "toggleItalics:": "italic", "toggleUnderline:": "underline", "_share:": "share"
  ]
}
