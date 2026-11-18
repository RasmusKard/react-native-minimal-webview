package expo.modules.minimalwebviewextensions

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Registers the extensions' hooks.
 * @suppress
 */
class MinimalWebViewExtensionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      // Order matters only between hooks that share a deciding callback, the touch listeners, a webViewFactory or a
      // setting; none of these do, so this is the README's order.
      BasicAuthCredential.register()
      Dialogs.register()
      Incognito.register()
      MenuItems.register()
      OnScroll.register()
      TransparentBackground.register()
      NestedScrollEnabled.register()
      AndroidLayerType.register()
      DownloadManager.register()
      OnLoadSubResourceError.register()
    }
  }
}
