# Security defaults

- File access is off, mixed content is never allowed, and SSL errors are always cancelled.
- There is no `addJavascriptInterface`. Android pages and their frames see one extra global, `nativeEvaluateResult`, for `evaluate` results: only the main frame's replies count, and a page can forge one only for a value it could already control.
- A page can open a window only from a tap, unless the `javaScriptCanOpenWindowsAutomatically` setting is on. An allowed new window loads in place (never a second WebView); one to an internal scheme or `file:` is blocked before the rules run, the rest go through them.
- The bridge works only for allowed origins, main frame only.
- `intent:` URLs are sanitised.
- Camera, microphone, location and protected media are granted only when `onPermissionRequest` says so, to the main frame only. Without it, Android denies and iOS shows WebKit's prompt.
- Download filenames are sanitised.
- Debugging is on only in `__DEV__`.

These are only defaults: [platform settings](platform-settings.md) such as `android.settings.allowFileAccess` or
`ios.webpagePreferences.allowsContentJavaScript` change them, on your responsibility.
