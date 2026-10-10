import { installPageClient } from '../bridge/pageClient';

type PageWindow = Parameters<typeof installPageClient>[0];
type NativeBridge = { call(method: string, params?: unknown): Promise<unknown> };

/** A page on an allowed origin with the Android transport: records what the page sends and its pageshow listener. */
function page(readyState = 'complete') {
  const sent: { kind: string }[] = [];
  let onDomReady: (() => void) | undefined;
  let onPageShow: ((event: { persisted: boolean }) => void) | undefined;
  const w = {
    location: { origin: 'https://example.com' },
    nativeBridgeTransport: {
      postMessage: (text: string) => sent.push(JSON.parse(text) as { kind: string }),
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
  installPageClient(w, 10_000, ['https://example.com']);
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
