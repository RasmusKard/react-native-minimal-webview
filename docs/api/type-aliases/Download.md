# Type Alias: Download

> **Download** = `object`

A finished download: `uri` is a `file://` in the app's cache (iOS: the temporary directory), which the core never
deletes. `url` is the server URL the file came from; `null` when the page generated it (`data:` or `blob:` URL).
`filename` is a plain file name, no path, but the page chose it, like the content and `mimeType`: don't open the file
as trusted.

## Properties

### filename

> **filename**: `string`

***

### mimeType

> **mimeType**: `string`

***

### ok

> **ok**: `true`

***

### uri

> **uri**: `string`

***

### url

> **url**: `string` \| `null`
