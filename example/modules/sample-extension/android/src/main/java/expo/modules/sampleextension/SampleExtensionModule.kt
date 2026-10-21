package expo.modules.sampleextension

import android.webkit.HttpAuthHandler
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.DocumentScope
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext
import org.json.JSONObject

class SampleExtensionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      MinimalWebViewHooks.register("pageCounter") { webView, context ->
        val counter = PageCounter(context)
        context.clients += counter
        // A live option: the page gets the count under the new name at once, without a reload.
        context.onOptionsChange { counter.stamp(webView) }
        // JS's `ref.hook('pageCounter', 'count')`.
        context.handle("count") { _, reply -> reply(counter.count) }
        context.onDocumentEnd { reason ->
          if (reason != DocumentScope.End.CLOSING) context.emit("documentEnd", mapOf("reason" to reason.name.lowercase()))
        }
        null
      }
      // Fixtures for the harness: decision callbacks the core implements, which these clients take over, so the
      // app's props are not asked.
      MinimalWebViewHooks.register("hookAuth") { _, context ->
        context.clients += HookAuth()
        null
      }
      MinimalWebViewHooks.register("hookDialogs") { _, context ->
        context.chromeClients += HookDialogs(context)
        null
      }
    }
  }
}

/** The hosts HookAuth gives credentials to: only the test pages server (`PAGES` in App.tsx, through `adb reverse`). */
private val AUTH_HOSTS = setOf("localhost")

/** Answers HTTP basic or digest challenges from AUTH_HOSTS itself, and cancels the rest. */
private class HookAuth : WebViewClient() {
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) =
    if (host in AUTH_HOSTS) handler.proceed("u", "p") else handler.cancel()
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
 * `onPageCommitVisible`, which it doesn't and forwards. Its option, `true` or `{ global: name }`, names the page's
 * global that gets the count (`__pageCount` by default).
 */
private class PageCounter(private val context: WebViewContext) : WebViewClient() {
  var count = 0
    private set

  override fun onPageFinished(view: WebView, url: String?) {
    count += 1
    stamp(view)
    context.emit("pageLoaded", mapOf("url" to url.orEmpty(), "count" to count))
  }

  override fun onPageCommitVisible(view: WebView, url: String?) {
    context.emit("commitVisible", mapOf("url" to url.orEmpty()))
  }

  fun stamp(view: WebView) {
    val global = (context.options as? Map<*, *>)?.get("global") as? String ?: "__pageCount"
    view.evaluateJavascript("window[${JSONObject.quote(global)}] = $count", null)
  }
}
