package expo.modules.minimalwebviewextensions

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Registers the extensions' hooks; each attaches only to a WebView whose `extensions` prop has its extension, with options that are on.
 * @suppress
 */
class MinimalWebViewExtensionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      // Hooks run in registration order. It matters only between hooks that share a deciding callback, a listener
      // list, a webViewFactory or a setting, and none of these do: this is the README's order.
      BasicAuthCredential.register()
      Dialogs.register()
      Incognito.register()
      MenuItems.register()
      OnScroll.register()
      TransparentBackground.register()
      NestedScrollEnabled.register()
      AndroidLayerType.register()
    }
  }
}
