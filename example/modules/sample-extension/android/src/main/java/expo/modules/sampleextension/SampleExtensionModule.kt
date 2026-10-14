package expo.modules.sampleextension

import android.webkit.HttpAuthHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

class SampleExtensionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      MinimalWebViewHooks.attach += { _, context ->
        if (context.options["pageCounter"] != null) context.clients += PageCounter(context)
        // A decision callback the core implements: this client takes it over, and the app's prop is not asked.
        if (context.options["hookAuth"] != null) context.clients += HookAuth()
        null
      }
    }
  }
}

/** Answers every HTTP basic or digest challenge itself. */
private class HookAuth : WebViewClient() {
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) =
    handler.proceed("u", "p")
}

/**
 * Counts page loads through two client callbacks: `onPageFinished`, which the core implements and fans out, and
 * `onPageCommitVisible`, which it doesn't and forwards.
 */
private class PageCounter(private val context: WebViewContext) : WebViewClient() {
  private var count = 0

  override fun onPageFinished(view: WebView, url: String?) {
    count += 1
    view.evaluateJavascript("window.__pageCount = $count", null)
    context.emit("pageCounter.pageLoaded", mapOf("url" to url.orEmpty(), "count" to count))
  }

  override fun onPageCommitVisible(view: WebView, url: String?) {
    context.emit("pageCounter.commitVisible", mapOf("url" to url.orEmpty()))
  }
}
