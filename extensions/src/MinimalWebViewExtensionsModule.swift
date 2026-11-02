import ExpoModulesCore

/// Registers the extensions' hooks; each attaches only to a WebView whose `extensions` prop has its extension, with options that are on.
public class MinimalWebViewExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      // Hooks run in registration order. It matters only between hooks that share a deciding callback or a
      // webViewClass, and none of these do: this is the README's order.
      BasicAuthCredential.register()
      Dialogs.register()
      MenuItems.register()
      OnScroll.register()
      HideKeyboardAccessoryView.register()
    }
  }
}
