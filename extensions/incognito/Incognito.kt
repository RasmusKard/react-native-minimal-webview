package expo.modules.minimalwebviewextensions

import android.webkit.WebSettings
import android.webkit.WebView
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

/**
 * The hook behind `incognito()`. Unlike react-native-webview's, it clears no history or autocomplete popup: a new
 * WebView has none.
 */
internal object Incognito {
  const val KEY = "@react-native-minimal-webview/extensions.incognito"

  private val attachOnlyToNewWebViews: (WebView, WebViewContext) -> Unit = { _, _ -> }

  fun register() = MinimalWebViewHooks.register(KEY, configure = attachOnlyToNewWebViews) { webView, context ->
    if (context.options == null) return@register
    cookieManager(webView).removeAllCookies(null)
    webView.clearCache(true)
    webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
  }
}
