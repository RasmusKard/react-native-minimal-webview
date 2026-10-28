# Type Alias: WebViewSource

> **WebViewSource** = \{ `body?`: `string`; `headers?`: `Record`\<`string`, `string`\>; `uri`: `string`; \} \| \{ `baseUrl?`: `string`; `html`: `string`; \}

What the WebView loads: a URL, or an HTML string.

## Union Members

### Type Literal

\{ `body?`: `string`; `headers?`: `Record`\<`string`, `string`\>; `uri`: `string`; \}

#### body?

> `optional` **body?**: `string`

Makes the request a POST with this form-urlencoded body (`a=1&b=2`). iOS sends `headers` with it and sets
`Content-Type` when they don't; Android's `postUrl` sends neither. `reload()` sends the POST again; crash
recovery doesn't (`onProcessGone` reports `recovered: false`).

#### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Sent with the first request only, not on later navigations.

#### uri

> **uri**: `string`

A `file://` URL gets read access to its directory on iOS; Android needs `android.settings.allowFileAccess`,
which lets a `file:` page read any file the app can.

***

### Type Literal

\{ `baseUrl?`: `string`; `html`: `string`; \}
