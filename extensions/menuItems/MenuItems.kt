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

/**
 * The hook behind `menuItems()`; its value is `{ items }`. The selection's action mode is
 * WebView's own `startActionMode`, so the hook makes its WebViews with [MenuWebView].
 */
internal object MenuItems {
  const val KEY = "@react-native-minimal-webview/extensions.menuItems"
  private val factory: (Context) -> WebView = ::MenuWebView

  fun register() = MinimalWebViewHooks.register(KEY, webViewFactory = factory) { webView, context ->
    // Another hook's factory won (the core warns): no menu.
    val view = webView as? MenuWebView ?: return@register null
    val apply = { view.menuItems = ((context.options as? Map<*, *>)?.get("items") as? List<*>)?.filterIsInstance<Map<*, *>>() }
    apply()
    context.onOptionsChange { apply() }
    view.onMenuItem = { item, done ->
      // As react-native-webview: the main frame's selection.
      view.evaluateJavascript("window.getSelection().toString()") { json ->
        val text = runCatching { JSONArray("[$json]").getString(0) }.getOrDefault("")
        context.emit("selection", mapOf("key" to item["key"], "label" to item["label"], "selectedText" to text))
        done()
      }
    }
    null
  }
}

/** A WebView whose selection toolbar shows `menuItems` instead of the system's actions. */
internal class MenuWebView(context: Context) : WebView(context) {
  /** react-native-webview's `{ key, label }` items; null leaves the system's actions. */
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

      // The mode ends once the selection is read: ending it first clears the selection.
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
