package expo.modules.minimalwebview.requests

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.net.Uri
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.widget.EditText
import android.widget.FrameLayout
import expo.modules.minimalwebview.MinimalWebView

/**
 * JS alert, confirm, prompt and beforeunload dialogs, with the texts of WebView's own. WebView's own stay on screen
 * when their WebView is destroyed, and a WebView older than 149 destroyed with one unanswered leaves the app's
 * WebViews without touches (https://crbug.com/504317449): these close with it, answered first.
 */
internal class JsDialogs(private val owner: MinimalWebView) {
  private val open = mutableMapOf<AlertDialog, JsResult>()

  fun alert(url: String?, message: String?, result: JsResult) = show(result) {
    setTitle(title(context, url)).setMessage(message).setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
  }

  fun confirm(url: String?, message: String?, result: JsResult) = show(result) {
    setTitle(title(context, url)).setMessage(message)
      .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
      .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
  }

  fun prompt(url: String?, message: String?, defaultValue: String?, result: JsPromptResult) = show(result) {
    val input = EditText(context).apply { setText(defaultValue) }
    val margin = (20 * context.resources.displayMetrics.density).toInt()
    val field = FrameLayout(context).apply {
      setPadding(margin, 0, margin, 0)
      addView(input)
    }
    setTitle(title(context, url)).setMessage(message).setView(field)
      .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
      .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
  }

  fun beforeUnload(message: String?, result: JsResult) = show(result) {
    setTitle(text(context, "js_dialog_before_unload_title") ?: "Confirm Navigation")
      .setMessage(text(context, "js_dialog_before_unload", message.orEmpty()) ?: message)
      .setPositiveButton(text(context, "js_dialog_before_unload_positive_button") ?: "Leave this Page") { _, _ -> result.confirm() }
      .setNegativeButton(text(context, "js_dialog_before_unload_negative_button") ?: "Stay on this Page") { _, _ -> result.cancel() }
  }

  /** Closes the dialogs on screen, each answered as cancelled. */
  fun close() {
    val closing = open.toMap()
    open.clear()
    closing.forEach { (dialog, result) ->
      // An Activity that was destroyed took the dialog's window with it, and dismiss() throws without one.
      if (dialog.window?.decorView?.isAttachedToWindow == true) dialog.dismiss()
      result.cancel()
    }
  }

  /** Always true: the dialog is this class's. Without an Activity to show it on, it is answered as cancelled, as WebView's own is. */
  private fun show(result: JsResult, build: AlertDialog.Builder.() -> Unit): Boolean {
    val activity = owner.appContext.currentActivity?.takeUnless(Activity::isFinishing)
    if (activity == null) {
      result.cancel()
      return true
    }
    val dialog = AlertDialog.Builder(activity).apply(build).setOnCancelListener { result.cancel() }.create()
    dialog.setOnDismissListener { open.remove(dialog) }
    open[dialog] = result
    dialog.show()
    return true
  }

  /** WebView's title for a dialog of the page at [url]. */
  private fun title(context: Context, url: String?): String {
    val uri = Uri.parse(url.orEmpty())
    val host = uri.host
    return if (host.isNullOrEmpty() || uri.scheme == "data") text(context, "js_dialog_title_default") ?: "JavaScript"
    else text(context, "js_dialog_title", "${uri.scheme}://$host") ?: host
  }

  /** The Android framework's own string [name], which has no public id; null where a device lacks it. */
  private fun text(context: Context, name: String, vararg args: Any?): String? =
    context.resources.getIdentifier(name, "string", "android").takeIf { it != 0 }?.let { context.getString(it, *args) }
}
