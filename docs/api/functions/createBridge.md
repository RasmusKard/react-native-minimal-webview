# Function: createBridge()

> **createBridge**\<`Methods`, `Events`\>(`options`): [`Bridge`](../type-aliases/Bridge.md)\<`Methods`, `Events`\>

Creates a promise-based RPC channel to `window.nativeBridge` in the pages of `allowedOrigins`, for one WebView's
`bridge` prop. The type arguments type the method names, params, results and event payloads of `call`, `handle`,
`emit` and `on`; nothing checks them at runtime, so a handler still validates what an untrusted page sends. Throws
for an invalid origin rule or timeout.

## Type Parameters

### Methods

`Methods` *extends* [`BridgeMethodMap`](../type-aliases/BridgeMethodMap.md) = [`BridgeMethodMap`](../type-aliases/BridgeMethodMap.md)

### Events

`Events` *extends* [`BridgeEventMap`](../type-aliases/BridgeEventMap.md) = [`BridgeEventMap`](../type-aliases/BridgeEventMap.md)

## Parameters

### options

[`BridgeOptions`](../type-aliases/BridgeOptions.md)

## Returns

[`Bridge`](../type-aliases/Bridge.md)\<`Methods`, `Events`\>

## See

https://github.com/RasmusKard/react-native-minimal-webview/blob/main/docs/examples.md#the-bridge
