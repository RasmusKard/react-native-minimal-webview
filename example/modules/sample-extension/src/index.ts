import type { WebViewExtension } from 'minimal-rn-webview';

/**
 * A third-party extension, registered by this local Expo module as "pageCounter": on each page load it sets
 * `window.__pageCount` in the page and emits `pageLoaded {url, count}`.
 */
export const pageCounter = (options: { onPageLoaded?: (url: string, count: number) => void } = {}): WebViewExtension => ({
  native: { name: 'pageCounter' },
  onEvent: (event, payload) => {
    if (event === 'pageLoaded') options.onPageLoaded?.(String(payload['url']), Number(payload['count']));
  },
});
