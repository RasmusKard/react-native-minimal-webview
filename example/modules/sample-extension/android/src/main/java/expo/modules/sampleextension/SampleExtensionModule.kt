package expo.modules.sampleextension

import android.content.Context
import android.webkit.HttpAuthHandler
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.functions.Queues
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
      // configure runs before the package sets the WebView up (`WebViewCompat.setProfile` goes here); the app's
      // `android.settings` apply after it and win.
      MinimalWebViewHooks.register("sample.pageCounter", configure = { webView, _ ->
        webView.settings.defaultFixedFontSize = 14
      }) { webView, context ->
        val counter = PageCounter(context)
        context.clients += counter
        // A `hookOptions` change arrives live; context.options is already the new value.
        context.onOptionsChange { counter.stamp(webView) }
        // Answers JS's `ref.hook('sample.pageCounter', 'count')`.
        context.handle("count") { _, reply -> reply(counter.count) }
        // A handler can reply later, here with the app's answer to an ask.
        context.handle("label") { _, reply -> context.ask("label", mapOf("count" to counter.count), reply) }
        context.onDocumentEnd { reason ->
          if (reason != DocumentScope.End.CLOSING) {
            context.emit("documentEnd", mapOf("reason" to reason.name.lowercase(), "url" to context.url))
          }
        }
        null // or a closure, run when this WebView goes away
      }
      // A client that overrides a decision callback (HTTP auth, a JS alert) takes it from the core.
      MinimalWebViewHooks.register("sample.hookAuth") { _, context ->
        context.clients += HookAuth()
        null
      }
      MinimalWebViewHooks.register("sample.hookDialogs") { _, context ->
        context.chromeClients += HookDialogs(context)
        null
      }
      // Each WebView that enables this hook is made by its factory, a crash's replacement too; others stay plain.
      MinimalWebViewHooks.register("sample.subclass", webViewFactory = ::SampleWebView) { webView, context ->
        val name = webView.javaClass.simpleName
        context.handle("class") { _, reply -> reply(name) }
        null
      }
      PerfProbe.register()
      Seams.register()
    }
    AsyncFunction("closedViews") { Seams.closed }.runOnQueue(Queues.MAIN)
    // The perf suite's frame-gap probe (PerfProbe.kt): module functions, so they work without a hook too.
    AsyncFunction("stallStart") { Stall.start() }.runOnQueue(Queues.MAIN)
    AsyncFunction("stallStop") { Stall.stop() }.runOnQueue(Queues.MAIN)
  }
}

/** The `sample.subclass` hook's WebView: an override of what WebView lets a subclass change would go here. */
private class SampleWebView(context: Context) : WebView(context)

/** The hosts HookAuth gives credentials to: only the test pages server (`PAGES` in App.tsx, through `adb reverse`). */
private val AUTH_HOSTS = setOf("localhost")

private class HookAuth : WebViewClient() {
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) =
    if (host in AUTH_HOSTS) handler.proceed("u", "p") else handler.cancel()
}

private class HookDialogs(private val context: WebViewContext) : WebChromeClient() {
  override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
    context.emit("alert", mapOf("message" to message))
    result.confirm()
    return true
  }
}

/**
 * Counts page loads. `onPageFinished` and `onPageCommitVisible` are observation callbacks: each reaches every client
 * that overrides it, after the core. Its option, `true` or `{ global: name }`, names the page's global that gets the
 * count (`__pageCount` by default).
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
