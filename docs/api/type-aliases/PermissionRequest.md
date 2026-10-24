# Type Alias: PermissionRequest

> **PermissionRequest** = `object`

`origin` is the requesting page's, as `location.origin` writes it. Only the main frame asks (on Android, which
doesn't name the frame, any frame of the top page's origin); other frames are denied without asking.

## Properties

### origin

> **origin**: `string`

***

### resources

> **resources**: [`PermissionResource`](PermissionResource.md)[]
