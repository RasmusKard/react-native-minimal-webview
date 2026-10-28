# Function: createWebViewRef()

> **createWebViewRef**(): [`WebViewRefObject`](../type-aliases/WebViewRefObject.md)

A ref to pass as a WebView's `ref`, made outside React (a module, a store) so code outside React can use it. Its
`current` is whichever WebView is mounted with it, and it keeps its subscribers across remounts.

## Returns

[`WebViewRefObject`](../type-aliases/WebViewRefObject.md)
