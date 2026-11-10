package expo.modules.minimalwebviewextensions

import android.webkit.CookieManager
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/** The cookie store [webView] uses, its profile's (`android.webView.profile`): only once the WebView is set up. */
internal fun cookieManager(webView: WebView): CookieManager =
  if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
    WebViewCompat.getProfile(webView).cookieManager
  } else {
    CookieManager.getInstance()
  }
