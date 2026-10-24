# Type Alias: LoadErrorEvent

> **LoadErrorEvent** = \{ `code`: `number`; `description`: `string`; `kind`: `"network"` \| `"ssl"`; `url`: `string`; \} \| \{ `kind`: `"http"`; `statusCode`: `number`; `url`: `string`; \}

A main-frame error. `network` and `ssl`: the load failed, no page arrived (`code` is the platform's error code); an
SSL error always cancels the load. `http`: the response had an HTTP error status (400+), and the site's own error
page shows.
