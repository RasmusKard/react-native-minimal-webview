# Function: useWebViewState()

> **useWebViewState**(`ref`): [`NavigationState`](../type-aliases/NavigationState.md)

The navigation state of the WebView mounted with `ref` (a `useRef`, `createRef` or `createWebViewRef` one);
re-renders on every change, and follows a remount. The initial state (`url: ''`) while none is mounted.

## Parameters

### ref

`RefObject`\<[`WebViewRef`](../type-aliases/WebViewRef.md) \| `null`\>

## Returns

[`NavigationState`](../type-aliases/NavigationState.md)

## See

https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#navigation-state
