import { installPageClient } from '../bridge/pageClient';

type PageWindow = Parameters<typeof installPageClient>[0];
type NativeBridge = {
  call(method: string, params?: unknown): Promise<unknown>;
  handle(method: string, handler: (params: unknown) => unknown): void;
  on(event: string, listener: (payload: unknown) => void): () => void;
  __receive(text: string): Promise<void>;
};

/** A page with the Android transport: records what the page sends and its pageshow listener. */
function page(readyState = 'complete') {
  const sent: { kind: string; id?: string; doc?: string; value?: unknown }[] = [];
  let onDomReady: (() => void) | undefined;
  let onPageShow: ((event: { persisted: boolean }) => void) | undefined;
  const w = {
    nativeBridgeTransport: {
      postMessage: (text: string) => sent.push(JSON.parse(text) as (typeof sent)[number]),
      onmessage: null,
    },
    document: {
      readyState,
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'DOMContentLoaded') onDomReady = listener;
      },
    },
    addEventListener: (type: string, listener: typeof onPageShow) => {
      if (type === 'pageshow') onPageShow = listener;
    },
  } as unknown as PageWindow;
  Object.assign(w, { top: w });
  installPageClient(w, 10_000);
  const bridge = w.nativeBridge as NativeBridge;
  return {
    sent,
    bridge,
    domReady: () => onDomReady?.(),
    show: (persisted: boolean) => onPageShow?.({ persisted }),
  };
}

describe('page client ready', () => {
  it('is sent at once when the document is already parsed', () => {
    expect(page('interactive').sent.map((m) => m.kind)).toEqual(['ready']);
  });

  it('waits for DOMContentLoaded while the document is loading; a call before it goes out', async () => {
    const { sent, bridge, domReady, show } = page('loading');
    const call = bridge.call('echo');
    expect(sent.map((m) => m.kind)).toEqual(['call']);
    domReady();
    expect(sent.map((m) => m.kind)).toEqual(['call', 'ready']);
    show(true); // settles the call, which nothing answers here
    await expect(call).rejects.toMatchObject({ code: 'navigated' });
  });
});

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
    const doc = sent[0]!.doc;
    bridge.handle('double', (n) => (n as number) * 2);
    await bridge.__receive(
      JSON.stringify({ id: 'n1', doc, kind: 'call', method: 'double', params: 4 })
    );
    expect(sent.at(-1)).toMatchObject({ kind: 'result', id: 'n1', doc, value: 8 });

    const call = bridge.call('echo', 1);
    const id = sent.at(-1)!.id!;
    await bridge.__receive(JSON.stringify({ id, doc, kind: 'result', value: 'ok' }));
    await expect(call).resolves.toBe('ok');
  });

  it("runs an event's other listeners when one throws, and reports the throw as an unhandled rejection", async () => {
    const { sent, bridge } = page();
    const reported: unknown[] = [];
    jest.spyOn(Promise, 'reject').mockImplementation((reason: unknown) => {
      reported.push(reason);
      return new Promise<never>(() => {});
    });
    const failure = new Error('listener failed');
    const seen: unknown[] = [];
    bridge.on('tick', () => {
      throw failure;
    });
    bridge.on('tick', (payload) => seen.push(payload));
    const event = { doc: sent[0]!.doc, kind: 'event', method: 'tick', params: 1 };
    await bridge.__receive(JSON.stringify(event));
    jest.restoreAllMocks();
    expect(seen).toEqual([1]);
    expect(reported).toEqual([failure]);
  });

  it('puts one token on everything it sends, and drops messages for another document', async () => {
    const { sent, bridge, show } = page();
    const doc = sent[0]!.doc;
    expect(doc).toMatch(/^[a-z0-9]+$/);
    bridge.handle('double', (n) => (n as number) * 2);
    const call = bridge.call('echo');
    const id = sent.at(-1)!.id!;
    await bridge.__receive(
      JSON.stringify({ id: 'n1', doc: 'other', kind: 'call', method: 'double', params: 4 })
    );
    await bridge.__receive(JSON.stringify({ id, doc: 'other', kind: 'result', value: 'stale' }));
    expect(sent.map((m) => [m.kind, m.doc])).toEqual([
      ['ready', doc],
      ['call', doc],
    ]);
    show(true); // settles the call, which only a message for another document answered
    await expect(call).rejects.toMatchObject({ code: 'navigated' });
  });
});
