# Type Alias: WebViewRefObject

> **WebViewRefObject** = `object`

What `createWebViewRef()` returns: a ref that outlives the WebViews mounted with it.

## Properties

### current

> `readonly` **current**: [`WebViewRef`](WebViewRef.md) \| `null`

The mounted WebView's ref, or null while none is mounted.

## Methods

### getState()

> **getState**(): [`NavigationState`](NavigationState.md)

The mounted WebView's navigation state, read synchronously; the initial state while none is mounted.

#### Returns

[`NavigationState`](NavigationState.md)

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Calls `listener` on every state change, including a WebView mounting or unmounting; a subscriber stays across
remounts. Returns the unsubscribe.

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`
