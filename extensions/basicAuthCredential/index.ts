import type { HookExtension } from 'react-native-minimal-webview';

/**
 * A user name and password, for {@link basicAuthCredential}.
 * @group Values
 */
export type BasicAuthCredential = { username: string; password: string };

/**
 * Answers HTTP auth challenges with `credential`.
 *
 * The credential goes to every server that challenges, over `http:` as well as `https:`, whether the WebView loads a
 * page, an iframe or a subresource from it.
 *
 * On iOS it answers basic challenges only. On Android it answers every HTTP auth request, digest included. Once the
 * site rejects the credential, it isn't sent again and the site's 401 page shows. A change applies from the next
 * challenge.
 *
 * If a native hook of your own also answers auth challenges, the order of the hooks decides which one answers. See
 * `navigationDelegates` (iOS) and `clients` (Android) of `WebViewContext`.
 *
 * An accepted credential stays in the WebView's network session until the app restarts. After it changes or is
 * switched off, an origin that accepted it can still receive it.
 * @group Extensions
 */
export const basicAuthCredential = (credential: BasicAuthCredential): HookExtension => ({
  key: '@react-native-minimal-webview/extensions.basicAuthCredential',
  options: credential,
});
