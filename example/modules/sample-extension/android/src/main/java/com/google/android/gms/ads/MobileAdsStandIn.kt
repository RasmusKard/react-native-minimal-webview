package com.google.android.gms.ads

import android.webkit.WebView

object MobileAds {
  val registeredAt = mutableListOf<String>()

  @JvmStatic
  fun registerWebView(webView: WebView) {
    registeredAt += webView.url.orEmpty()
  }
}
