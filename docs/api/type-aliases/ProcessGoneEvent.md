# Type Alias: ProcessGoneEvent

> **ProcessGoneEvent** = `object`

The renderer process died, for `onProcessGone`.

## Properties

### didCrash

> **didCrash**: `boolean`

False when the system killed the renderer for memory (Android). Always true on iOS: WebKit doesn't say.

***

### recovered

> **recovered**: `boolean`

The core reloads the page: on iOS in place; on Android in a new WebView, once the app is in the foreground and the
view on screen, with the history restored unless the `source` page was on screen, and with the props applied but
not what `call` set. False while a POST `source` is on screen, which, as in a browser, isn't sent again unasked
(`reload()` sends it), and after more than 3 crashes in 60 s, counted for the whole app on Android, until the next
`reload()` (on iOS also a `source` change).
