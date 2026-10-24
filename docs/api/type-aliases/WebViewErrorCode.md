# Type Alias: WebViewErrorCode

> **WebViewErrorCode** = `"script_error"` \| `"native_error"` \| `"navigated"` \| `"unavailable"` \| `"hook_not_handled"`

Why a ref method rejected. `script_error`: `evaluate`'s script threw, rejected or didn't parse. `native_error`: the
platform refused or failed a `get`, `call` or `hook`. `navigated`: the page went away before `evaluate` finished.
`unavailable`: the WebView lacks the features it needs (Android System WebView older than 101), is gone, or is being
rebuilt after its renderer died (Android, while the app is in the background or the view detached).
`hook_not_handled`: no attached hook handles the `hook` method.
