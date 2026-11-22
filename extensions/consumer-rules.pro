# googleMobileAds() finds the Google Mobile Ads SDK's registerWebView by name (GoogleMobileAds.kt).
# R8 would otherwise strip or rename it in an app whose own code never calls it.
-keep class com.google.android.gms.ads.MobileAds { public static void registerWebView(android.webkit.WebView); }
-keep class com.google.android.libraries.ads.mobile.sdk.MobileAds { public static void registerWebView(android.webkit.WebView); }
