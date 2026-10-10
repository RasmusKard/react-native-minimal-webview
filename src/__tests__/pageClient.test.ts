import { installPageClient } from '../bridge/pageClient';

type PageWindow = Parameters<typeof installPageClient>[0];
type NativeBridge = { call(method: string, params?: unknown): Promise<unknown> };

/** A page on an allowed origin with the Android transport: records what the page sends and its pageshow listener. */
function page() {
  const sent: { kind: string }[] = [];
  let onPageShow: ((event: { persisted: boolean }) => void) | undefined;
  const w = {
    location: { origin: 'https://example.com' },
    nativeBridgeTransport: {
      postMessage: (text: string) => sent.push(JSON.parse(text) as { kind: string }),
      onmessage: null,
    },
    addEventListener: (type: string, listener: typeof onPageShow) => {
      if (type === 'pageshow') onPageShow = listener;
    },
  } as unknown as PageWindow;
  Object.assign(w, { top: w });
  installPageClient(w, 10_000, ['https://example.com']);
  const bridge = w.nativeBridge as NativeBridge;
  return { sent, bridge, show: (persisted: boolean) => onPageShow?.({ persisted }) };
}

describe('page client after the back-forward cache', () => {
  it('fails calls cut off by leaving the page and announces the page again', async () => {
    const { sent, bridge, show } = page();
    const call = bridge.call('echo');
    show(true);
    await expect(call).rejects.toMatchObject({ code: 'navigated' });
    expect(sent.map((m) => m.kind)).toEqual(['ready', 'call', 'ready']);
  });

  it('leaves calls and the bridge alone on a first show (not from the cache)', async () => {
    const { sent, bridge, show } = page();
    const call = bridge.call('echo');
    show(false);
    expect(sent.map((m) => m.kind)).toEqual(['ready', 'call']);
    show(true); // settles the call, which the first show left pending
    await expect(call).rejects.toMatchObject({ code: 'navigated' });
  });
});
