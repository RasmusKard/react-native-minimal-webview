# Function: warmUp()

> **warmUp**(): `void`

Starts WebView (its code and Chromium) in the background, so that the first WebView mounts faster, blocks the UI
thread less and sends its first request sooner. Call it at app start when a WebView shows soon after: right before
the mount it gains less. React Native's first `fetch` starts WebView too (its cookie jar is WebView's
`CookieManager`), so an app that fetches early gets part of this anyway. No-op on iOS.

## Returns

`void`

## Platform

android
