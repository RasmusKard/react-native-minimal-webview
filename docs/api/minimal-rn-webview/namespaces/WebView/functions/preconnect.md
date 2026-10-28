# Function: preconnect()

> **preconnect**(`url`): `void`

Opens a connection to `url`'s origin (DNS, TCP, TLS) in WebView's default profile, for a load that follows; nothing
on a WebView without `Profile.enqueuePreconnect` or `Profile.preconnect`. It starts WebView on the UI thread if
nothing has yet, so call it once `warmUp()` has had time or a WebView is mounted, a moment before the load.
Prefetch and prerender aren't wrapped: a native hook reaches them through `ProfileStore`. No-op on iOS.

## Parameters

### url

`string`

## Returns

`void`

## Platform

android
