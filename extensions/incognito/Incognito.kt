package expo.modules.minimalwebviewextensions

import android.webkit.WebSettings
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind `incognito()`, as react-native-webview's: the cookies and HTTP cache of the WebView's profile are
 * cleared before the WebView loads anything, and its cache is off. A new WebView has no history and no autocomplete
 * popup to clear.
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
