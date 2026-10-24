# Type Alias: BridgeErrorCode

> **BridgeErrorCode** = *typeof* `ERROR_CODES`\[`number`\]

Why a bridge call rejected. `timeout`: no answer in time. `not_found`: no handler for the method. `handler_error`:
the handler threw or rejected (the `message` is its error's), or the page sent a code not listed here. `navigated`:
the page navigated or crashed, or the WebView unmounted, while the call was pending. `unavailable`: the WebView lacks
the features the bridge needs (Android System WebView older than 101).
