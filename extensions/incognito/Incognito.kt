package expo.modules.minimalwebviewextensions

import android.webkit.WebSettings
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind `incognito()`. Unlike react-native-webview's, it clears no history or autocomplete popup: a new
 * WebView has none.
 */
internal object Incognito {
  const val KEY = "@react-native-minimal-webview/extensions.incognito"

  fun register() = MinimalWebViewHooks.register(
    KEY,
    // Nothing to set up this early, but with a configure the hook attaches only to a new WebView, never to one in use.
    configure = { _, _ -> }
  ) { webView, context ->
    // Off: it still attaches to the WebView that replaces a crashed one when the extension was switched off since.
    if (context.options == null) return@register
    // Not in configure: only now is the WebView on its profile (`android.webView.profile`), whose store this clears.
    cookieManager(webView).removeAllCookies(null)
    webView.clearCache(true)
    webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
  }
}
