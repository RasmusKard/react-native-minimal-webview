import ExpoModulesCore

/// Registers the extensions' hooks.
public class MinimalWebViewExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      // Order matters only between hooks that share a deciding callback, a webViewClass or a setting; none of these do,
      // so this is the README's order.
      BasicAuthCredential.register()
      Dialogs.register()
      Incognito.register()
      MenuItems.register()
      OnScroll.register()
      TransparentBackground.register()
      HideKeyboardAccessoryView.register()
      KeyboardDisplayRequiresUserAction.register()
      RefreshControlLightMode.register()
      RemoveIosKeyboardObserver.register()
    }
  }
}
