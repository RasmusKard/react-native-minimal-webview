package expo.modules.minimalwebviewextensions

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Registers the extensions' hooks; each attaches only to a WebView whose `hookOptions` turns its key on.
 * @suppress
 */
class MinimalWebViewExtensionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      // Hooks run in registration order. It matters only between hooks that share a deciding callback, a listener
      // list or a webViewFactory, and none of these do: this is the README's order.
      BasicAuthCredential.register()
      Dialogs.register()
      MenuItems.register()
      OnScroll.register()
      NestedScrollEnabled.register()
      AndroidLayerType.register()
    }
  }
}
