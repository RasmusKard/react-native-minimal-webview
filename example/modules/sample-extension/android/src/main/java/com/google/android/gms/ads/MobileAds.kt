package com.google.android.gms.ads

import android.webkit.WebView

/** A stand-in under the Google Mobile Ads SDK's class name, for the extensions suite's googleMobileAds() check. */
object MobileAds {
  val registeredAt = mutableListOf<String>()

  @JvmStatic
  fun registerWebView(webView: WebView) {
    registeredAt += webView.url.orEmpty()
  }
}
