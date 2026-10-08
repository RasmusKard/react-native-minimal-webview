package expo.modules.minimalwebview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MinimalWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MinimalWebView")

    AsyncFunction("setValueAsync") { value: String ->
    }

    View(MinimalWebView::class) {
      // Defines an event that the view can send to JavaScript.
      Events("onTap")
    }
  }
}
