import { installPageClient } from '../bridge/pageClient';

type PageWindow = Parameters<typeof installPageClient>[0];
type NativeBridge = {
  call(method: string, params?: unknown): Promise<unknown>;
  handle(method: string, handler: (params: unknown) => unknown): void;
  __receive(text: string): Promise<void>;
};

/** A page on an allowed origin with the Android transport: records what the page sends and its pageshow listener. */
function page() {
  const sent: { kind: string; id?: string; params?: unknown }[] = [];
  let onPageShow: ((event: { persisted: boolean }) => void) | undefined;
  const w = {
    location: { origin: 'https://example.com' },
    nativeBridgeTransport: {
      postMessage: (text: string) => sent.push(JSON.parse(text) as (typeof sent)[number]),
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

describe('page client messages from native', () => {
  it('sends the answer to a native call as a message, and takes the answer to its own call from __receive', async () => {
    const { sent, bridge } = page();
    bridge.handle('double', (n) => (n as number) * 2);
    await bridge.__receive(JSON.stringify({ v: 1, id: 'n1', kind: 'call', method: 'double', params: 4 }));
    expect(sent.at(-1)).toMatchObject({ kind: 'result', id: 'n1', params: 8 });

    const call = bridge.call('echo', 1);
    const id = sent.at(-1)!.id!;
    await bridge.__receive(JSON.stringify({ v: 1, id, kind: 'result', params: 'ok' }));
    await expect(call).resolves.toBe('ok');
  });
});
