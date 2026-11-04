package expo.modules.minimalwebviewextensions

import android.webkit.CookieManager
import android.webkit.WebSettings
import expo.modules.minimalwebview.MinimalWebViewHooks

/**
 * The hook behind `incognito()`, as react-native-webview's: the app's cookies and HTTP cache are cleared before the
 * WebView loads anything, and its cache is off. A new WebView has no history and no autocomplete popup to clear.
 */
internal object Incognito {
  const val KEY = "@react-native-minimal-webview/extensions.incognito"

  fun register() = MinimalWebViewHooks.register(
    KEY,
    configure = { webView, _ ->
      CookieManager.getInstance().removeAllCookies(null)
      webView.clearCache(true)
    }
  ) { webView, _ -> webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE }
}
