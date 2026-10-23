// Type-level checks, run by `npx tsc --noEmit -p src/__tests__/tsconfig.json`: each expected error below must occur.
import { createBridge } from '../bridge/createBridge';
import type { Bridge, WebViewProps } from '../types';

type Methods = {
  share: { params: { url: string }; result: boolean };
  getCartCount: { result: number };
};
type Events = { themeChanged: 'light' | 'dark' };

function typed(bridge: Bridge<Methods, Events>) {
  bridge.handle('share', async ({ url }) => url.length > 0);
  bridge.handle('share', (params, { origin }) => params.url === origin);
  // @ts-expect-error because the handler returns the wrong result type
  bridge.handle('share', () => 'yes');
  // @ts-expect-error because the method isn't in the map
  bridge.handle('unknown', () => true);

  const count: Promise<number> = bridge.call('getCartCount');
  void bridge.call('share', { url: 'https://example.com' }, { timeoutMs: 0 });
  // @ts-expect-error because the param type is wrong
  void bridge.call('share', { url: 1 });
  // @ts-expect-error because the result is a number
  const wrong: Promise<string> = bridge.call('getCartCount');

  bridge.emit('themeChanged', 'dark');
  // @ts-expect-error because the payload isn't one of the event's
  bridge.emit('themeChanged', 'blue');
  bridge.on('themeChanged', (theme) => theme satisfies 'light' | 'dark');

  // A typed bridge goes in the `bridge` prop.
  const prop: WebViewProps['bridge'] = bridge;
  return [count, wrong, prop];
}

function untyped(bridge: Bridge) {
  bridge.handle('anything', (params: unknown, sender) => [params, sender.origin]);
  const result: Promise<unknown> = bridge.call('anything', { any: 'thing' });
  bridge.emit('anything', 1);
  bridge.on('anything', (payload: unknown) => payload);
  // @ts-expect-error because only createBridge makes a Bridge: a hand-made one would connect nothing
  const handMade: Bridge = {
    handle: () => () => {},
    call: async () => {},
    emit() {},
    on: () => () => {},
  };
  return [result, handMade];
}

it('types the bridge from its type arguments, and leaves an untyped one unknown', () => {
  const options = { allowedOrigins: ['https://example.com'] };
  expect([typed, untyped].length).toBe(2);
  createBridge<Methods, Events>(options) satisfies Bridge<Methods, Events>;
  createBridge(options) satisfies Bridge;
});
