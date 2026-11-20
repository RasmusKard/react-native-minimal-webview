// The test pages server's origins (test-pages/server.js). EXPO_PUBLIC_PAGES_PORT and EXPO_PUBLIC_PAGES_HTTPS_PORT move
// its ports, for the server and the bundle alike, so a second checkout can run its own beside the first.
export const PAGES_PORT = process.env.EXPO_PUBLIC_PAGES_PORT ?? '8090';
export const PAGES = `http://localhost:${PAGES_PORT}`;
/** The same pages as another site: a second origin for cross-origin checks. */
export const OTHER = `http://127.0.0.1:${PAGES_PORT}`;
/** The same pages with a self-signed certificate: an SSL error. */
export const HTTPS = `https://localhost:${process.env.EXPO_PUBLIC_PAGES_HTTPS_PORT ?? '8443'}`;
