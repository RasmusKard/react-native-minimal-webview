# Type Alias: PermissionRequest

> **PermissionRequest** = `object`

`origin` is the requesting page's, as `location.origin` writes it; every `file:` page is `file://`. Only the main
frame asks (on Android, which doesn't name the frame, any frame of the top page's origin); other frames, and a page
with an opaque origin (`data:`, a sandboxed frame), are denied without asking.

## Properties

### origin

> **origin**: `string`

***

### resources

> **resources**: [`PermissionResource`](PermissionResource.md)[]
