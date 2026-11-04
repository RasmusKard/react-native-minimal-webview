import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Starts the WebView without the cookies and cache stored before: react-native-webview's `incognito`. Turn it on when
 * the WebView is created: it applies to that WebView, and a later change, switching it off included, doesn't.
 *
 * On iOS the WebView gets a data store of its own that isn't saved: its cookies, cache and storage go with it.
 * `sharedCookies` still copies cookies in and out.
 *
 * Android has no incognito WebView: this clears the app's cookies and HTTP cache, for its other WebViews too, and
 * turns the cache off. Cookies set after that are kept, as is the pages' own storage, such as `localStorage`. The
 * WebView that replaces one whose renderer crashed clears them again.
 * @group Extensions
 */
export const incognito = (): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.incognito',
});
