import ExpoModulesCore

public class MinimalWebViewExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      BasicAuthCredential.register()
      Dialogs.register()
      GoogleMobileAds.register()
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
