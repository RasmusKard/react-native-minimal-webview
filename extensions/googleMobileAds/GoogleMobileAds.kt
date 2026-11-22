package expo.modules.minimalwebviewextensions

import android.webkit.WebView
import expo.modules.minimalwebview.MinimalWebViewHooks
import java.lang.reflect.Method

internal object GoogleMobileAds {
  const val KEY = "@react-native-minimal-webview/extensions.googleMobileAds"
  private val SDK_CLASSES = listOf(
    "com.google.android.gms.ads.MobileAds",
    "com.google.android.libraries.ads.mobile.sdk.MobileAds",
  )

  fun register() = MinimalWebViewHooks.register(KEY, newWebViewsOnly = true) { webView, context ->
    val registerWebView = SDK_CLASSES.firstNotNullOfOrNull(::registerWebViewIn)
    if (registerWebView == null) context.emit("sdkMissing", emptyMap()) else registerWebView.invoke(null, webView)
  }

  private fun registerWebViewIn(className: String): Method? =
    try {
      Class.forName(className).getMethod("registerWebView", WebView::class.java)
    } catch (_: ReflectiveOperationException) {
      null
    }
}
