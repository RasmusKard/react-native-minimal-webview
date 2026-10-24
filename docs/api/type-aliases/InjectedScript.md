# Type Alias: InjectedScript

> **InjectedScript** = `object`

Runs at document start, before any page script. Code for when the DOM is parsed goes in
`addEventListener('DOMContentLoaded', …)`.

## Properties

### code

> **code**: `string`

***

### mainFrameOnly?

> `optional` **mainFrameOnly?**: `boolean`

`false` runs it in every frame, iframes included.

#### Default

```ts
true
```
