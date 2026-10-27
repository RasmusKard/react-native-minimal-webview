# Variable: reactNativeWebViewMessages

> `const` **reactNativeWebViewMessages**: [`InjectedScript`](../type-aliases/InjectedScript.md)

react-native-webview's messaging, for `injectedScripts`: the page's `window.ReactNativeWebView.postMessage(data)`
emits `String(data)` as the bridge event `rnw`, for `bridge.on('rnw', …)`, and `bridge.emit('rnw', data)` dispatches
a `message` event with that `data` on `window` on iOS and on `document` on Android, as react-native-webview does. It
needs the `bridge` prop: only the main frame of the pages in `allowedOrigins` gets `window.ReactNativeWebView`.
