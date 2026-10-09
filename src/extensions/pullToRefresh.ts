import type { WebViewExtension } from '../types';

/** Pull down at the top of the page to reload: SwipeRefreshLayout on Android, UIRefreshControl on iOS. */
export const pullToRefresh = (): WebViewExtension => ({ native: { name: 'pullToRefresh' } });
