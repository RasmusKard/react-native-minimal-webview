# react-native-minimal-webview

A React Native WebView whose native side owns the navigation state and the lifetime of everything a page asks for.

## Language

**Document**:
The main-frame page a WebView shows now: it begins when a navigation commits, a back-forward-cache restore included,
and ends at the next commit (on Android a failed load commits an error page; on iOS nothing commits and the Document
lives on), a renderer crash, or the view closing. Asks, evaluations, the bridge reply target, the ask cache, the file
chooser, the open JS dialog (iOS), fullscreen video (Android), the refresh spinner (iOS, on crash) and new-window child
WebViews (Android) belong to one Document and end with it ([ADR 0001](docs/adr/0001-document-scope.md)).
_Avoid_: page, when its lifetime matters
