package expo.modules.minimalwebviewextensions

import android.content.Context
import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.WebView
import expo.modules.minimalwebview.MinimalWebViewHooks
import org.json.JSONArray

/** The selection's action mode is WebView's own `startActionMode`. */
internal object MenuItems {
  const val KEY = "@react-native-minimal-webview/extensions.menuItems"
  private val factory: (Context) -> WebView = ::MenuWebView

  fun register() = MinimalWebViewHooks.register(KEY, webViewFactory = factory) { webView, context ->
    val view = webView as? MenuWebView ?: return@register
    context.onOptions { options ->
      view.menuItems = ((options as? Map<*, *>)?.get("items") as? List<*>)?.filterIsInstance<Map<*, *>>()
    }
    view.onMenuItem = { item, done ->
      view.evaluateJavascript("window.getSelection().toString()") { json ->
        val text = runCatching { JSONArray("[$json]").getString(0) }.getOrDefault("")
        context.emit("selection", mapOf("key" to item["key"], "label" to item["label"], "selectedText" to text))
        done()
      }
    }
  }
}

internal class MenuWebView(context: Context) : WebView(context) {
  var menuItems: List<Map<*, *>>? = null
  var onMenuItem: ((item: Map<*, *>, done: () -> Unit) -> Unit)? = null

  override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
    val items = menuItems ?: return super.startActionMode(callback, type)
    return super.startActionMode(object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        items.forEachIndexed { i, item -> menu.add(Menu.NONE, i, i, item["label"] as? String) }
        return true
      }

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false

      // Ending the mode clears the selection.
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        val chosen = items.getOrNull(item.itemId) ?: return false
        onMenuItem?.invoke(chosen) { mode.finish() } ?: mode.finish()
        return true
      }

      override fun onDestroyActionMode(mode: ActionMode) = Unit

      override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
        if (callback is ActionMode.Callback2) callback.onGetContentRect(mode, view, outRect) else super.onGetContentRect(mode, view, outRect)
      }
    }, type)
  }
}
