# The bridge

```tsx
const bridge = useMemo(() => createBridge({ allowedOrigins: ['https://example.com', 'https://*.example.com'] }), []);
useEffect(
  () => bridge.handle('share', async (params) => { await Share.share({ url: (params as { url: string }).url, message }); return true }), // the unsubscribe
  [bridge, message]
);

<WebView bridge={bridge} … />
await bridge.call('getCartCount');   // a method the page registered
bridge.emit('themeChanged', 'dark');

// In the page
await window.nativeBridge.call('share', { url: location.href }, { timeoutMs: 0 }); // the share sheet waits on the user
window.nativeBridge.handle('getCartCount', () => cart.length);
window.nativeBridge.on('themeChanged', (theme) => applyTheme(theme));
```

Make the bridge once (`useMemo`): a new one recreates the WebView. One bridge serves one mounted WebView at a time;
attaching it to a second throws. Every allowed origin can call every handler, so a handler meant for some origins only
checks the sender's origin, which native code reads, not the page's message:

```tsx
bridge.handle('getToken', (_, { origin }) => {
  if (origin !== 'https://example.com') throw new Error('not for this origin');
  return token;
});
```

Every message is for one document and never reaches the next page, even on the same origin. A call in flight when the
page goes away rejects with `navigated`, maybe after the other side handled it: retry only calls safe to repeat.

## Typing the bridge

One map covers both directions. The types check nothing at runtime, so validate what an untrusted page sends, and
write the maps as `type`s: an `interface` doesn't satisfy `BridgeMethodMap`.

```tsx
type Methods = {
  share: { params: { url: string }; result: boolean }; // handled in React Native
  getCartCount: { result: number }; // handled by the page
};
type Events = { themeChanged: 'light' | 'dark' };

const bridge = useMemo(() => createBridge<Methods, Events>({ allowedOrigins: ['https://example.com'] }), []);
useEffect(() => bridge.handle('share', async ({ url }) => (await Share.share({ url })).action === Share.sharedAction), [bridge]);
const count = await bridge.call('getCartCount'); // number
bridge.emit('themeChanged', 'dark');
```

```ts
// A TypeScript page's types
declare global {
  interface Window {
    /** Only on an allowed origin, in the main frame. */
    nativeBridge?: {
      /** Rejects with an `Error` whose `code` is one of the bridge's error codes. */
      call(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
      handle(method: string, handler: (params: unknown) => unknown): () => void; // returns the unsubscribe
      emit(event: string, payload?: unknown): void;
      on(event: string, listener: (payload: unknown) => void): () => void; // returns the unsubscribe
    };
  }
}
```

Recipes on the bridge: [scroll position](migrating-from-react-native-webview.md#scroll-position) (there is no `onScroll`)
and [`window.ReactNativeWebView`](migrating-from-react-native-webview.md#postmessage-and-onmessage) pages.
