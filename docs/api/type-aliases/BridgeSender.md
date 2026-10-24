# Type Alias: BridgeSender

> **BridgeSender** = `object`

Who sent a call or event: the page's origin as `location.origin` writes it (`https://example.com:8443`), checked by
native code, not taken from the page. Every allowed origin gets the same trust; a handler scopes itself with this.

## Properties

### origin

> **origin**: `string`
