package expo.modules.minimalwebviewextensions

import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

/** The hook behind the `onDialog` prop: each alert, confirm and prompt is an ask, which the page waits for. */
internal object Dialogs {
  const val KEY = "minimal-rn-webview-extensions.dialogs"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    val client = Client(context)
    // A listed chrome client takes every dialog: listed only while the prop is set, so WebView's dialogs come back.
    val list = { on: Boolean ->
      context.chromeClients.remove(client)
      if (on) context.chromeClients.add(client)
    }
    list(true)
    context.onOptionsChange { list(it != null) }
    null
  }

  private class Client(private val context: WebViewContext) : WebChromeClient() {
    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult) =
      ask("alert", url, message, null) { result.confirm() }

    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult) =
      ask("confirm", url, message, null) { if (it == true) result.confirm() else result.cancel() }

    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult) =
      ask("prompt", url, message, defaultValue) { answer -> (answer as? String)?.let(result::confirm) ?: result.cancel() }

    private fun ask(type: String, url: String?, message: String?, defaultValue: String?, onAnswer: (Any?) -> Unit): Boolean {
      context.ask(type, mapOf("message" to message.orEmpty(), "defaultValue" to defaultValue, "url" to url.orEmpty()), onAnswer)
      return true
    }
  }
}
