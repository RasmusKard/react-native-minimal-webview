# Type Alias: BridgeOptions

> **BridgeOptions** = `object`

The options of `createBridge`.

## Properties

### allowedOrigins

> **allowedOrigins**: `string`[]

The origins whose pages get `window.nativeBridge`, main frame only: `'*'` (any origin, opaque ones too),
`'https://example.com'`, `'https://*.example.com'` (subdomains only, not `example.com`) or an IP literal
(`'http://[::1]:8080'`), each with an optional port. http or https, no path, ASCII (punycode) hosts; case is
ignored, and a missing port means 80 or 443.

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-call timeout in milliseconds; `0` or `Infinity` means none.

#### Default

```ts
10000
```
