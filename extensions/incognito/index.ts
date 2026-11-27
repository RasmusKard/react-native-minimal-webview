import type { HookExtension } from 'react-native-minimal-webview';

/**
 * Starts the WebView without the cookies and cache stored before.
 *
 * Turn it on when the WebView is created. A later change, switching it off included, doesn't apply to that WebView.
 *
 * On iOS, the WebView gets its own data store, which isn't saved. Its cookies, cache and storage go away with it.
 * `sharedCookies` still copies cookies in and out.
 *
 * On Android, it clears the cookies and HTTP cache of the WebView's profile and turns the cache off. That profile is
 * the app's, unless `android.webView.profile` names another, and the clear reaches the profile's other WebViews too.
 * Cookies set after that are kept, and so is the pages' own storage, such as `localStorage`. While the extension is on,
 * the WebView that replaces one whose renderer crashed clears them again.
 * @group Extensions
 */
export const incognito = (): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.incognito',
});
