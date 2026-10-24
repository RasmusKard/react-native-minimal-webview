# Type Alias: PermissionResource

> **PermissionResource** = `"camera"` \| `"microphone"` \| `"geolocation"` \| `"protectedMedia"`

`geolocation` and `protectedMedia` (the device id DRM playback needs, Widevine) are Android only: on iOS, location
always shows WebKit's own prompt, and FairPlay asks nothing.
