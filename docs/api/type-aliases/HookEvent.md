# Type Alias: HookEvent\<N, P\>

> **HookEvent**\<`N`, `P`\> = `object`

An event a native hook sent with `emit` or `ask`, named `'<hook key>.<event name>'`. `N` and `P` type one hook's
events: `HookEvent<'pageCounter.pageLoaded', { count: number }>`.

## Type Parameters

### N

`N` *extends* `string` = `string`

### P

`P` = `Record`\<`string`, `unknown`\>

## Properties

### name

> **name**: `N`

***

### payload

> **payload**: `P`
