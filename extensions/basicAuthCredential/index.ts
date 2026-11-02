import type { HookExtension } from 'react-native-minimal-webview';

/**
 * A user name and password, for {@link basicAuthCredential}.
 * @group Values
 */
export type BasicAuthCredential = { username: string; password: string };

/**
 * Answers HTTP auth challenges with `credential`, on every host: react-native-webview's `basicAuthCredential`.
 *
 * iOS answers HTTP basic challenges, and Android every HTTP auth request, digest included. Neither sends the credential
 * again once the site has rejected it: the site's 401 page shows. A change applies from the next challenge.
 *
 * On iOS, a challenge it doesn't answer goes on to the native hooks' navigation delegates listed after it, then to
 * WebKit's default handling.
 *
 * A credential once accepted stays with the WebView's network session, as in a browser: after it changes or is
 * switched off, an origin that accepted it can still get it, until the app restarts.
 * @group Extensions
 */
export const basicAuthCredential = (credential: BasicAuthCredential): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.basicAuthCredential',
  options: credential,
});
