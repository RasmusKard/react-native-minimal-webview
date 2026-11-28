package expo.modules.minimalwebviewextensions

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** @suppress */
class MinimalWebViewExtensionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebViewExtensions")
    OnCreate {
      BasicAuthCredential.register()
      Dialogs.register()
      GoogleMobileAds.register()
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
