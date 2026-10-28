# Function: warmUp()

> **warmUp**(): `void`

Starts WebView (loads its code, starts Chromium) ahead of the first WebView, on a background thread where the
device's WebView supports that, so the first WebView loads sooner. Call it at app start when a WebView shows soon
after. React Native's first `fetch` starts WebView too (its cookie jar is WebView's `CookieManager`), so an app that
fetches early gets part of this anyway. No-op on iOS.

## Returns

`void`

## Platform

android
