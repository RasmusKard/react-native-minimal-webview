package expo.modules.sampleextension

import android.content.Context
import android.util.AndroidRuntimeException
import android.util.Log
import android.webkit.HttpAuthHandler
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.DocumentEnd
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext
import org.json.JSONObject
import java.util.Locale

class SampleExtensionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SampleExtension")
    OnCreate {
      MinimalWebViewHooks.register("sample.pageCounter", configure = { webView, _ ->
        webView.settings.defaultFixedFontSize = 14
      }) { webView, context ->
        val counter = PageCounter(context)
        context.clients += counter
        context.onOptions { options ->
          counter.global = (options as? Map<*, *>)?.get("global") as? String ?: "__pageCount"
          counter.stamp(webView)
        }
        context.handle("count") { _, reply -> reply(counter.count) }
        context.handle("label") { _, reply ->
          context.ask("label", mapOf("count" to counter.count)) { answer ->
            if (answer != null) reply(answer) else reply.fail("the app gave no label")
          }
        }
        context.onDocumentEnd { reason ->
          if (reason != DocumentEnd.CLOSING) {
            context.emit("documentEnd", mapOf("reason" to reason.name.lowercase(), "url" to context.url))
          }
        }
      }
      MinimalWebViewHooks.register("sample.hookAuth") { _, context ->
        context.clients += HookAuth()
      }
      MinimalWebViewHooks.register("sample.hookDialogs") { _, context ->
        context.chromeClients += HookDialogs(context)
      }
      MinimalWebViewHooks.register("sample.hookNavigation") { _, context ->
        context.clients += HookNavigation()
      }
      MinimalWebViewHooks.register("sample.subclass", webViewFactory = ::SampleWebView) { webView, context ->
        val name = webView.javaClass.simpleName
        context.handle("class") { _, reply -> reply(name) }
      }
      MinimalWebViewHooks.register("sample.noWebView", webViewFactory = { context ->
        if (webViewMissing) throw AndroidRuntimeException("No WebView installed")
        WebView(context)
      }) { _, _ -> }
      PerfProbe.register()
      Seams.register()
    }
    AsyncFunction("closedViews") { Seams.closed }.runOnQueue(Queues.MAIN)
    AsyncFunction("setWebViewMissing") { missing: Boolean -> webViewMissing = missing }.runOnQueue(Queues.MAIN)
    AsyncFunction("stallStart") { Stall.start() }.runOnQueue(Queues.MAIN)
    AsyncFunction("stallStop") { Stall.stop() }.runOnQueue(Queues.MAIN)
    AsyncFunction("destroyedWebViewCalls") { since: Long -> destroyedWebViewCalls(since) }
  }
}

private fun destroyedWebViewCalls(since: Long): Int {
  val marker = "log read ${System.nanoTime()}"
  Log.i("SampleExtension", marker)
  val sinceSeconds = String.format(Locale.ROOT, "%d.%03d", since / 1000, since % 1000)
  repeat(LOG_READS) {
    val lines = ProcessBuilder("logcat", "-d", "-T", sinceSeconds, "-s", "cr_AwContents:W", "SampleExtension:I")
      .start().inputStream.bufferedReader().use { it.readLines() }
    if (lines.any { marker in it }) return lines.count { "Application attempted to call on a destroyed WebView" in it }
    Thread.sleep(LOG_READ_GAP_MS)
  }
  error("the app cannot read its own log")
}

private const val LOG_READS = 10
private const val LOG_READ_GAP_MS = 100L

private var webViewMissing = false

private class SampleWebView(context: Context) : WebView(context)

private val AUTH_HOSTS = setOf("localhost")

private class HookAuth : WebViewClient() {
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) =
    if (host in AUTH_HOSTS) handler.proceed("u", "p") else handler.cancel()
}

private class HookNavigation : WebViewClient() {
  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false
}

private class HookDialogs(private val context: WebViewContext) : WebChromeClient() {
  override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
    context.emit("alert", mapOf("message" to message))
    result.confirm()
    return true
  }
}

private class PageCounter(private val context: WebViewContext) : WebViewClient() {
  var count = 0
    private set
  var global = "__pageCount"

  override fun onPageFinished(view: WebView, url: String?) {
    count += 1
    stamp(view)
    context.emit("pageLoaded", mapOf("url" to url.orEmpty(), "count" to count))
  }

  override fun onPageCommitVisible(view: WebView, url: String?) {
    context.emit("commitVisible", mapOf("url" to url.orEmpty()))
  }

  fun stamp(view: WebView) {
    view.evaluateJavascript("window[${JSONObject.quote(global)}] = $count", null)
  }
}
