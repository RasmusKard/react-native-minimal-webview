# Page requests

The page asks for things only the app can answer. Each request works without its prop, and the prop takes it over.

| The page | Default (no prop) | Prop | Typical packages |
|---|---|---|---|
| `<input type="file">` | iOS: WebKit's picker (needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`). Android: the system file chooser; it ignores `capture` | `onFileRequest({ accept, multiple, capture })` (Android only) returns URIs, or `null` to cancel | expo-document-picker, expo-image-picker |
| Fullscreen video | iOS: WebKit's. Android: the page's fullscreen view covers the WebView's window on black, system bars hide, and back exits | `onFullscreenChange({ active })` (Android only) | expo-screen-orientation |
| Camera, microphone, (Android) location and protected media | Android: denied. iOS: WebKit's own prompt (location always prompts; FairPlay asks nothing) | `onPermissionRequest({ origin, resources })` answers `true` or `false`. Main frame only: other frames are denied without asking. `protectedMedia` is the device id DRM (Widevine) playback needs | expo-camera, expo-audio, expo-location |
| A download | http(s): opens externally (`onOpenExternal`, or the system browser, which fetches it without the page's session; reported to `onNavigation` as `external`). `data:` and `blob:`: dropped | `onDownload(result)`: a [file in the app's cache](#downloads), or a failure | expo-file-system, expo-sharing |
| HTTP basic or digest auth | Declined: the site's 401 page shows | No prop: a [native hook](native-hooks.md) answers it, as `HookAuth` in `example/modules/sample-extension` does | expo-secure-store |

`onPermissionRequest` never makes the OS prompt: the app asks the OS (expo-camera, expo-location), and without OS
permission the page's request fails anyway (`NotReadableError`, geolocation code 2 or 3). On iOS, `true` skips WebKit's
own prompt. Android's WebView keeps a location answer until the page changes.

An unanswered request is cancelled when its page is replaced (navigation, reload, crash, unmount). Until then, a handler that
never settles blocks that page's further requests of the same kind.

A [native hook](native-hooks.md) whose delegate or client takes the same platform callback comes before these props.

## Downloads

With `onDownload`, the core saves the file: `WKDownload` on iOS (the page's session) into the temporary directory; on
Android it is fetched again with the page's cookies and user agent into the cache, `data:` and `blob:` too. A POST
body, the `headers` prop and HTTP auth credentials don't go with an Android fetch, so such a download can fail
or save the wrong file (a login page). The result is `{ uri, filename, mimeType, url }` with a `file://` `uri`, or
`{ filename, url, reason }` when it failed: `'uri' in result` tells them apart. `url` is the server URL the file came
from; `null` when the page generated it (`data:` or `blob:` URL).

## Recipes

File upload with expo-document-picker, or expo-image-picker for photos and the camera:

```tsx
<WebView
  onFileRequest={async ({ accept, multiple }) => {
    const mimeTypes = accept.filter((type) => type.includes('/')); // the picker takes MIME types, not `.pdf`
    const result = await DocumentPicker.getDocumentAsync({ type: mimeTypes.length ? mimeTypes : '*/*', multiple });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  }}
/>
```

```tsx
onFileRequest={async ({ multiple, capture }) => {
  const pick = capture ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await pick({ allowsMultipleSelection: multiple });
  return result.canceled ? null : result.assets.map((asset) => asset.uri);
}}
```

Camera for one site, with expo-camera:

```tsx
onPermissionRequest={async ({ origin, resources }) => {
  if (origin !== 'https://meet.example.com' || !resources.every((resource) => resource === 'camera')) return false;
  return (await Camera.requestCameraPermissionsAsync()).granted;
}}
```

Let a portrait-locked app rotate while a video is fullscreen (Android), with expo-screen-orientation:

```tsx
onFullscreenChange={({ active }) =>
  active ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
}
```

A download is a file in the app's cache. The app opens, saves or shares it, with expo-file-system and expo-sharing:

```tsx
// Open it: Quick Look on iOS, an app for the MIME type on Android.
onDownload={(result) => 'uri' in result && new File(result.uri).preview()}

// Save it where the user chooses: a folder pick on Android, the share sheet's "Save to Files" on iOS.
onDownload={async (result) => {
  if (!('uri' in result)) return console.warn('download failed', result.reason);
  if (Platform.OS === 'ios') return Sharing.shareAsync(result.uri);
  const target = (await Directory.pickDirectoryAsync()).createFile(result.filename, result.mimeType);
  await target.write(await new File(result.uri).bytes());
}}

// Share it.
onDownload={(result) => 'uri' in result && Sharing.shareAsync(result.uri)}
```
