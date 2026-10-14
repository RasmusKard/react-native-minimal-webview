package expo.modules.sampleextension

import android.webkit.HttpAuthHandler
import android.webkit.JsResult
import android.webkit.WebChromeClient
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
      MinimalWebViewHooks.attach["pageCounter"] = { _, context ->
        context.clients += PageCounter(context)
        null
      }
      // Decision callbacks the core implements: these clients take them over, and the app's props are not asked.
      MinimalWebViewHooks.attach["hookAuth"] = { _, context ->
        context.clients += HookAuth()
        null
      }
      MinimalWebViewHooks.attach["hookDialogs"] = { _, context ->
        context.chromeClients += HookDialogs(context)
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

/** Answers every alert itself and reports it, instead of the core's dialog. */
private class HookDialogs(private val context: WebViewContext) : WebChromeClient() {
  override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
    context.emit("alert", mapOf("message" to message))
    result.confirm()
    return true
  }
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
    context.emit("pageLoaded", mapOf("url" to url.orEmpty(), "count" to count))
  }

  override fun onPageCommitVisible(view: WebView, url: String?) {
    context.emit("commitVisible", mapOf("url" to url.orEmpty()))
  }
}
