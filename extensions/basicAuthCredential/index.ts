import type { HookExtension } from 'react-native-minimal-webview';

/**
 * A user name and password, for {@link basicAuthCredential}.
 * @group Values
 */
export type BasicAuthCredential = { username: string; password: string };

/**
 * Answers HTTP auth challenges with `credential`: react-native-webview's `basicAuthCredential`.
 *
 * It goes to every server that challenges: any host the WebView loads a page, an iframe or a subresource from, over
 * `http:` as well as `https:`.
 *
 * iOS answers HTTP basic challenges, and Android every HTTP auth request, digest included. Neither sends the credential
 * again once the site has rejected it: the site's 401 page shows. A change applies from the next challenge.
 *
 * With a native hook of your own that answers auth challenges too, the order of the hooks decides which one answers:
 * see `navigationDelegates` (iOS) and `clients` (Android) of `WebViewContext`.
 *
 * A credential once accepted stays with the WebView's network session, as in a browser: after it changes or is
 * switched off, an origin that accepted it can still get it, until the app restarts.
 * @group Extensions
 */
export const basicAuthCredential = (credential: BasicAuthCredential): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.basicAuthCredential',
  options: credential,
});
