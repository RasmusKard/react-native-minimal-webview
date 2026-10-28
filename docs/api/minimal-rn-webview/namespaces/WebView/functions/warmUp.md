# Function: warmUp()

> **warmUp**(): `void`

Starts WebView (loads its code, starts Chromium) ahead of the first WebView, on a background thread where the
device's WebView supports that. Measured on Android System WebView 149 (an emulator, a Debug build): called at app
start, it brought the first WebView's first `onLoadEnd` about 15% sooner, a median of 287 against 339 ms from the
app's first render (5 launches each, all 5 with it faster than all 5 without). Call it at app start when a WebView
shows soon after. React Native's first `fetch` starts WebView too (its cookie jar is WebView's `CookieManager`), so
an app that fetches early gets part of this anyway. No-op on iOS.

## Returns

`void`

## Platform

android
