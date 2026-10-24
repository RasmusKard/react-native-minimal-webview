# Type Alias: BridgeMethodMap

> **BridgeMethodMap** = `Record`\<`string`, \{ `params?`: `unknown`; `result?`: `unknown`; \}\>

The methods either side may call, for `createBridge<Methods>`:
`{ share: { params: { url: string }; result: boolean } }`. One map covers both directions, so a method is named once,
whichever side handles it. A `type`, not an `interface` (an interface has no index signature, so it doesn't satisfy
`Record`).
