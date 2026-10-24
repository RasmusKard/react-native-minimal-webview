# Type Alias: NavigationEvent

> **NavigationEvent** = [`NavigationRequest`](NavigationRequest.md) & `object`

A navigation decision, for `onNavigation`.

## Type Declaration

### action

> **action**: [`NavigationAction`](NavigationAction.md)

Without `onOpenExternal`, an `external` URL that no app opens is reported as `block`.

### rule

> **rule**: `number` \| `null`

Index of the matching rule in `navigationRules`, or null when no rule did (a default, or a download opened
externally).
