import type { WebViewExtension } from '../types';

export type AuthRequest = { host: string; realm: string };

/**
 * HTTP basic and digest auth: `onAuthRequest` returns credentials, or null to cancel (the site's 401 page shows).
 * Without this extension auth challenges are cancelled on both platforms.
 */
export const httpAuth = (options: {
  onAuthRequest: (
    request: AuthRequest
  ) =>
    | { username: string; password: string }
    | null
    | Promise<{ username: string; password: string } | null>;
}): WebViewExtension => ({
  native: { name: 'httpAuth' },
  on: { authRequest: options.onAuthRequest },
});
