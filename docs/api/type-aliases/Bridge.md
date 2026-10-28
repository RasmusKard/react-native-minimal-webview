# Type Alias: Bridge\<Methods, Events\>

> **Bridge**\<`Methods`, `Events`\> = `object`

A promise-based RPC channel to `window.nativeBridge` in the page. Attach it with the `bridge` prop. What it sends
waits for the page's `DOMContentLoaded`, so the handlers and listeners of the page's synchronous and deferred scripts
are in place, and never reaches a later page, even one on the same origin; the page's own calls work earlier.
Messages have no size limit. The page's `window.nativeBridge` has the same four methods, `call(method, params?,
{ timeoutMs? })`, `handle`, `emit` and `on`, and its calls reject with an `Error` whose `code` is a
[BridgeErrorCode](BridgeErrorCode.md).

## See

https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#the-bridge

## Type Parameters

### Methods

`Methods` *extends* [`BridgeMethodMap`](BridgeMethodMap.md) = [`BridgeMethodMap`](BridgeMethodMap.md)

### Events

`Events` *extends* [`BridgeEventMap`](BridgeEventMap.md) = [`BridgeEventMap`](BridgeEventMap.md)

## Properties

### \[CONNECTION\]

> `readonly` **\[CONNECTION\]**: `BridgeConnection`

What `<WebView>` attaches to. Only `createBridge` sets it, so a hand-made or mock `Bridge` doesn't type-check.

## Methods

### call()

> **call**\<`M`\>(`method`, `params?`, `options?`): `Promise`\<`Methods`\[`M`\]\[`"result"`\]\>

Calls a method the page registered with `nativeBridge.handle`. Rejects with a [BridgeCallError](BridgeCallError.md); after
`navigated` the page may have handled the call already, so retry only calls that are safe to repeat. `timeoutMs`
overrides the bridge's for this call, and one that isn't 0 or more rejects with a plain `RangeError`.

#### Type Parameters

##### M

`M` *extends* `string`

#### Parameters

##### method

`M`

##### params?

`Methods`\[`M`\]\[`"params"`\]

##### options?

###### timeoutMs?

`number`

#### Returns

`Promise`\<`Methods`\[`M`\]\[`"result"`\]\>

***

### emit()

> **emit**\<`E`\>(`event`, `payload?`): `void`

Fires an event the page listens to with `nativeBridge.on`. Dropped if the page goes away before it arrives.

#### Type Parameters

##### E

`E` *extends* `string`

#### Parameters

##### event

`E`

##### payload?

`Events`\[`E`\]

#### Returns

`void`

***

### handle()

> **handle**\<`M`\>(`method`, `handler`): () => `void`

Answers `nativeBridge.call(method, params)` from the page. One handler per method: a later one replaces it.
Returns an unsubscribe function, which removes only this handler.

#### Type Parameters

##### M

`M` *extends* `string`

#### Parameters

##### method

`M`

##### handler

[`BridgeHandler`](BridgeHandler.md)\<`Methods`\[`M`\]\[`"params"`\], `Methods`\[`M`\]\[`"result"`\]\>

#### Returns

() => `void`

***

### on()

> **on**\<`E`\>(`event`, `listener`): () => `void`

Listens to `nativeBridge.emit(event, payload)` from the page. Returns an unsubscribe function.

#### Type Parameters

##### E

`E` *extends* `string`

#### Parameters

##### event

`E`

##### listener

(`payload`, `sender`) => `void`

#### Returns

() => `void`
