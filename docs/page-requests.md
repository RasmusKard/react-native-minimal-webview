# Page requests

The page asks for things only the app can answer. Each request works without a prop: a prop answers it (the file
chooser, permissions) or is told afterwards (fullscreen video, downloads), and only a [native hook](native-hooks.md)
takes over JS dialogs and HTTP auth.

| The page | Without a prop | Prop | Typical packages |
|---|---|---|---|
| `<input type="file">` | iOS: WebKit's picker (needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`). Android: the system file chooser | `onFileRequest` (Android) | expo-document-picker, expo-image-picker |
| Fullscreen video | The platform's fullscreen view | `onFullscreenChange` (Android) | expo-screen-orientation |
| Camera, microphone, (Android) location, protected media | Android: denied. iOS: WebKit's own prompt | `onPermissionRequest` | expo-camera, expo-audio, expo-location |
| A download | http(s): opens externally. `data:` and `blob:`: dropped | `onDownload`: the core saves the file | expo-file-system, expo-sharing |
| `alert`, `confirm`, `prompt` | iOS: a `UIAlertController` titled with the frame's host, one at a time (one that can't be presented is cancelled, and so is an open one when the Document ends). Android: WebView's own dialogs | None: a native hook, as `HookDialogs` in `example/modules/sample-extension` | |
| HTTP basic or digest auth | Declined: the site's 401 page shows | None: a native hook, as `HookAuth` in `example/modules/sample-extension` | expo-secure-store |

No prop makes an OS prompt: the app asks the OS (expo-camera, expo-location), and without OS permission the page's
request fails anyway. Each prop can be added or removed at any time, and a native hook whose delegate or client takes
the same platform callback comes before it.

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

A download is a file in the app's cache, its content, name and type chosen by the page, so don't trust it. The app
opens, saves or shares it, with expo-file-system and expo-sharing:

```tsx
// Open it: Quick Look on iOS, an app for the MIME type on Android.
onDownload={(result) => result.ok && new File(result.uri).preview()}

// Save it where the user chooses: a folder pick on Android, the share sheet's "Save to Files" on iOS.
onDownload={async (result) => {
  if (!result.ok) return console.warn('download failed', result.reason);
  if (Platform.OS === 'ios') return Sharing.shareAsync(result.uri);
  const target = (await Directory.pickDirectoryAsync()).createFile(result.filename, result.mimeType);
  await target.write(await new File(result.uri).bytes());
}}

// Share it.
onDownload={(result) => result.ok && Sharing.shareAsync(result.uri)}
```
