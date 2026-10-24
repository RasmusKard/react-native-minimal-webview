# Type Alias: NavigationAction

> **NavigationAction** = `"allow"` \| `"block"` \| `"external"`

What happens to a navigation. `allow`: it loads in place, on iOS a tapped universal link too (instead of opening the
app that claims it). `block`: it is cancelled. `external`: `onOpenExternal`, or else the system, opens it.
