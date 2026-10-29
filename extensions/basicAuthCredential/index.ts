import type { HookExtension } from 'minimal-rn-webview';

/**
 * A user name and password, for {@link basicAuthCredential}.
 * @group Values
 */
export type BasicAuthCredential = { username: string; password: string };

/**
 * Answers HTTP auth challenges with `credential`, on every host: react-native-webview's `basicAuthCredential`.
 *
 * iOS answers HTTP basic challenges, and doesn't send a credential again once the site has rejected it; Android
 * answers every HTTP auth request. A change applies from the next challenge. Without it, the core's handling applies:
 * the challenge is declined and the site's 401 page shows. On iOS, a challenge it doesn't answer goes on to a later
 * hook's delegate, by the rule on `WebViewContext.navigationDelegates` (ios/Hooks.swift), and only then to the core's
 * handling.
 *
 * A credential once accepted stays with the WebView's network session, as in a browser: after it changes or is
 * switched off, an origin that accepted it can still get it, until the app restarts.
 * @group Extensions
 */
export const basicAuthCredential = (credential: BasicAuthCredential): HookExtension => ({
  key: '@minimal-rn-webview/extensions.basicAuthCredential',
  options: credential,
});
