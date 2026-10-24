# Type Alias: BridgeHandler\<Params, Result\>

> **BridgeHandler**\<`Params`, `Result`\> = (`params`, `sender`) => `Result` \| `Promise`\<`Result`\>

Answers a bridge call: the return value (a promise is awaited) is the result. A throw or rejection rejects the call
with `handler_error` and the error's message.

## Type Parameters

### Params

`Params` = `unknown`

### Result

`Result` = `unknown`

## Parameters

### params

`Params`

### sender

[`BridgeSender`](BridgeSender.md)

## Returns

`Result` \| `Promise`\<`Result`\>
