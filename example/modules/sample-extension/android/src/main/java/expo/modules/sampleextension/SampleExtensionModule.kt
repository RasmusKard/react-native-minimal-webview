package expo.modules.sampleextension

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.ExtensionHost
import expo.modules.minimalwebview.WebViewExtension
import expo.modules.minimalwebview.WebViewExtensions

class SampleExtensionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SampleExtension")
    OnCreate { WebViewExtensions.register("pageCounter") { PageCounter() } }
  }
}

/** Uses only the public extension interface: no access to the WebView's internals. */
private class PageCounter : WebViewExtension {
  private lateinit var host: ExtensionHost
  private var count = 0

  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) {
    this.host = host
  }

  override fun onPageFinished(url: String) {
    count += 1
    host.evaluate("window.__pageCount = $count") {}
    host.emit("pageLoaded", mapOf("url" to url, "count" to count))
  }
}
