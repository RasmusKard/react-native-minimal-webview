# Type Alias: NavigationRule

> **NavigationRule** = `object`

One navigation rule. Every field it sets must match; for a list, one matching entry is enough.

## Properties

### action

> **action**: [`NavigationAction`](NavigationAction.md) \| `"ask"`

`ask` calls `onNavigationRequest`. On Android it works only for the main frame (elsewhere it is `block`), waits for
the next frame, and loads an allowed navigation again, without the page's referrer policy or the gesture flag.

***

### host?

> `optional` **host?**: `string`[]

Exact, or a `*.` suffix wildcard that matches subdomains only: `['*.example.com']` does not match `example.com`.
Case, port, userinfo and a trailing dot are ignored.

***

### mainFrame?

> `optional` **mainFrame?**: `boolean`

Android decides only an iframe's non-http(s) navigations, so a `mainFrame: false` rule for http(s) is iOS only.

***

### newWindow?

> `optional` **newWindow?**: `boolean`

`target=_blank` or `window.open`, a main-frame navigation. An allowed one loads in place: there is never a second
WebView, so no `window.opener` (a native hook that takes `createWebViewWith` on iOS or `onCreateWindow` on Android
owns real popups). One to `data:`, `blob:`, `javascript:`, `about:` or `file:` is always blocked (on Android,
WebView may still run a `javascript:` one's script, with the page's origin), and one opened with no URL
(`window.open('')`) is decided when the page first sends it to one, or dropped when that doesn't happen within 5 s.

***

### path?

> `optional` **path?**: `string`[]

Plain prefixes of the percent-encoded URL path: `['/checkout']` also matches `/checkouts`. A URL without an
authority (`myapp:/open`) has the path `/`.

***

### query?

> `optional` **query?**: `string`[]

Query parameters, percent-encoded as in the URL and case-sensitive: `gad_source` matches a parameter with that
name, whatever its value; `utm_term=google` matches only that exact value.

***

### scheme?

> `optional` **scheme?**: `string`[]

Exact, case-insensitive: `['tel', 'mailto']`.

***

### userInitiated?

> `optional` **userInitiated?**: `boolean`

A user gesture started it (Android `hasGesture()`, iOS `.linkActivated`). A `location.href` change or `window.open`
from a click handler is true on Android, but false on iOS, where only a tapped link is.
