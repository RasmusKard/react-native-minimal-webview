package expo.modules.minimalwebviewextensions

import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

/** The hook behind `dialogs()`: each alert, confirm and prompt is an ask, which the page waits for. */
internal object Dialogs {
  const val KEY = "@react-native-minimal-webview/extensions.dialogs"

  fun register() = MinimalWebViewHooks.register(KEY) { _, context ->
    context.chromeClients += Client(context)
  }

  private class Client(private val context: WebViewContext) : WebChromeClient() {
    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult) =
      ask("alert", url, message, null) { result.confirm() }

    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult) =
      ask("confirm", url, message, null) { if (it == true) result.confirm() else result.cancel() }

    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult) =
      ask("prompt", url, message, defaultValue) { answer -> (answer as? String)?.let(result::confirm) ?: result.cancel() }

    /** The payload is the JS `Dialog`: only a prompt has a `defaultValue`. */
    private fun ask(type: String, url: String?, message: String?, defaultValue: String?, onAnswer: (Any?) -> Unit): Boolean {
      val dialog = mapOf("type" to type, "message" to message.orEmpty(), "url" to url.orEmpty())
      context.ask(type, if (type == "prompt") dialog + ("defaultValue" to defaultValue) else dialog, onAnswer)
      return true
    }
  }
}
