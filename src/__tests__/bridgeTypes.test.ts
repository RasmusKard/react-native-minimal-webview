// Type-level checks, run by `npx tsc --noEmit -p src/__tests__/tsconfig.json`: each expected error below must occur.
import { createBridge } from '../bridge/createBridge';
import { installPageClient } from '../bridge/pageClient';
import type { Bridge, PageBridge, WebViewProps } from '../types';

type Shop = {
  reactNative: {
    share: { params: { url: string }; result: boolean };
    log: { params?: string };
  };
  page: {
    getCartCount: { result: number };
    setTheme: { params: 'light' | 'dark'; result: void };
  };
  events: { themeChanged: 'light' | 'dark'; reloaded: undefined };
};

function typed(bridge: Bridge<Shop>) {
  bridge.handle('share', async ({ url }) => url.length > 0);
  bridge.handle('share', (params, { origin }) => params.url === origin);
  // @ts-expect-error because the handler returns the wrong result type
  bridge.handle('share', () => 'yes');
  bridge.handle('log', (line) => line satisfies string | undefined);
  // @ts-expect-error because the page handles getCartCount, not React Native
  bridge.handle('getCartCount', () => 1);
  // @ts-expect-error because the method isn't in the schema
  bridge.handle('unknown', () => true);

  const count: Promise<number> = bridge.call('getCartCount');
  void bridge.call('getCartCount', undefined, { timeoutMs: 0 });
  void bridge.call('setTheme', 'dark', { timeoutMs: 0 });
  // @ts-expect-error because the method isn't in the schema
  void bridge.call('typo');
  // @ts-expect-error because setTheme declares params, so they are required
  void bridge.call('setTheme');
  // @ts-expect-error because the param type is wrong
  void bridge.call('setTheme', 'blue');
  // @ts-expect-error because React Native handles share, not the page
  void bridge.call('share', { url: 'https://example.com' });
  // @ts-expect-error because getCartCount takes no params
  void bridge.call('getCartCount', 1);
  // @ts-expect-error because the result is a number
  const wrong: Promise<string> = bridge.call('getCartCount');

  bridge.emit('themeChanged', 'dark');
  bridge.emit('reloaded');
  // @ts-expect-error because the event declares a payload, so it is required
  bridge.emit('themeChanged');
  // @ts-expect-error because the payload isn't one of the event's
  bridge.emit('themeChanged', 'blue');
  bridge.on('themeChanged', (theme) => theme satisfies 'light' | 'dark');
  // @ts-expect-error because the event isn't in the schema
  bridge.emit('typo');

  // A bridge of any schema goes in the `bridge` prop.
  const prop: WebViewProps['bridge'] = bridge;
  return [count, wrong, prop];
}

/** The page's side, as the page's own code declares `window.nativeBridge` with a type-only import. */
function page(nativeBridge: PageBridge<Shop>) {
  nativeBridge.handle('getCartCount', () => 3);
  nativeBridge.handle('setTheme', (theme) => void (theme satisfies 'light' | 'dark'));
  // @ts-expect-error because the handler returns the wrong result type
  nativeBridge.handle('getCartCount', () => '3');
  // @ts-expect-error because React Native handles share, not the page
  nativeBridge.handle('share', () => true);

  const shared: Promise<boolean> = nativeBridge.call('share', { url: 'https://example.com' });
  void nativeBridge.call('log');
  void nativeBridge.call('log', 'line', { timeoutMs: 0 });
  // @ts-expect-error because share declares params, so they are required
  void nativeBridge.call('share');
  // @ts-expect-error because the param type is wrong
  void nativeBridge.call('share', { url: 1 });
  // @ts-expect-error because the page handles getCartCount, not React Native
  void nativeBridge.call('getCartCount');

  nativeBridge.emit('reloaded');
  // @ts-expect-error because the event declares a payload, so it is required
  nativeBridge.emit('themeChanged');
  // @ts-expect-error because the payload isn't one of the event's
  nativeBridge.emit('themeChanged', 'blue');
  nativeBridge.on('themeChanged', (theme) => theme satisfies 'light' | 'dark');
  // @ts-expect-error because the event isn't in the schema
  nativeBridge.on('typo', () => {});
  return shared;
}

/** The page client's `window.nativeBridge` is a PageBridge. */
function pageClient(w: Parameters<typeof installPageClient>[0]) {
  const installed: PageBridge | undefined = w.nativeBridge;
  return installed;
}

function untyped(bridge: Bridge, nativeBridge: PageBridge) {
  bridge.handle('anything', (params: unknown, sender) => [params, sender.origin]);
  const result: Promise<unknown> = bridge.call('anything', { any: 'thing' });
  void bridge.call('anything');
  bridge.emit('anything', 1);
  bridge.emit('anything');
  bridge.on('anything', (payload: unknown) => payload);
  nativeBridge.handle('anything', (params: unknown) => params);
  void nativeBridge.call('anything', 1, { timeoutMs: 0 });
  // @ts-expect-error because only createBridge makes a Bridge: a hand-made one would connect nothing
  const handMade: Bridge = {
    handle: () => () => {},
    call: async () => {},
    emit() {},
    on: () => () => {},
  };
  return [result, handMade];
}

it('types each side of the bridge from its schema, and leaves an untyped one unknown', () => {
  const options = { allowedOrigins: ['https://example.com'] };
  expect([typed, page, pageClient, untyped].length).toBe(4);
  createBridge<Shop>(options) satisfies Bridge<Shop>;
  createBridge(options) satisfies Bridge;
});
