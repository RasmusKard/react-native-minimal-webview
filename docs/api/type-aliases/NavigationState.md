# Type Alias: NavigationState

> **NavigationState** = `object`

A WebView's navigation state, as native reports it: from `useWebViewState` and `onNavigationStateChange`.

## Properties

### canGoBack

> **canGoBack**: `boolean`

***

### canGoForward

> **canGoForward**: `boolean`

***

### loading

> **loading**: `boolean`

***

### outcome

> **outcome**: `"finished"` \| `"failed"` \| `"cancelled"` \| `null`

How the last main-frame load ended; null while one is loading, and before the first. `failed`: a network or SSL
error, or a renderer crash, cut it off. `cancelled`: it never showed a page (a stop before the response, a
download, a 204, a redirect the rules blocked, a load a newer one replaced); a stop after the page arrived is
`cancelled` on iOS but `finished` on Android. An HTTP error status (404) is `finished`: the site's page shows, and
`onError` gets an `http` error.

***

### pendingUrl

> **pendingUrl**: `string` \| `null`

A main-frame load in progress, which may still fail or be blocked. Iframes never change it. Always null on Android
with a WebView older than 146.

***

### progress

> **progress**: `number`

From 0 to 1.

***

### title

> **title**: `string`

***

### url

> **url**: `string`

The page on screen: changes on commit and same-document navigation (pushState, replaceState, hash), and stays the
old page while a load is in progress. After a failed load, the failed URL. Iframes never change it.
