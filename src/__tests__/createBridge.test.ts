import { CONNECTION, createBridge } from '../bridge/createBridge';
import type { BridgeMessage } from '../bridge/protocol';

function setup(timeoutMs = 1000) {
  const bridge = createBridge({ allowedOrigins: ['https://example.com'], timeoutMs });
  const connection = bridge[CONNECTION];
  const sent: (BridgeMessage & { id?: string })[] = [];
  connection.attach((text) => sent.push(JSON.parse(text) as BridgeMessage & { id?: string }));
  const fromPage = (message: object) =>
    connection.receive(JSON.stringify({ doc: 'd1', ...message }), 'https://example.com');
  return { bridge, connection, sent, fromPage };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createBridge', () => {
  afterEach(() => jest.useRealTimers());

  it('injects a page client that runs on its own, with its timeout', async () => {
    const { connection } = setup(2500);
    expect(connection.script).toMatch(/\)\(window, 2500\);$/);
    const sent: { kind: string; doc: string; value?: unknown }[] = [];
    const transport = {
      postMessage: (text: string) => sent.push(JSON.parse(text) as (typeof sent)[number]),
      onmessage: null as ((event: { data: string }) => void) | null,
    };
    const page = {
      location: { origin: 'https://example.com' },
      nativeBridgeTransport: transport,
      document: { readyState: 'complete', addEventListener: () => {} },
      addEventListener: () => {},
      nativeBridge: undefined as
        { handle(method: string, handler: (p: number) => number): void } | undefined,
    };
    Object.assign(page, { top: page });
    // eslint-disable-next-line no-new-func -- because the script native injects is what this test runs, as the page would
    const inject = new Function('window', 'location', connection.script) as (
      window: unknown,
      location: unknown
    ) => void;
    inject(page, page.location);
    page.nativeBridge?.handle('double', (n) => n * 2);
    const doc = sent[0]?.doc;
    transport.onmessage?.({
      data: JSON.stringify({ id: 'n1', kind: 'call', method: 'double', params: 4, doc }),
    });
    await Promise.resolve();
    expect(sent.map((m) => [m.kind, m.value])).toEqual([
      ['ready', undefined],
      ['result', 8],
    ]);
  });

  it('queues messages until the page is ready', () => {
    const { bridge, sent, fromPage } = setup();
    bridge.emit('hello', 1);
    expect(sent).toEqual([]);
    fromPage({ kind: 'ready' });
    expect(sent).toEqual([{ doc: 'd1', kind: 'event', method: 'hello', params: 1 }]);
  });

  it('resolves a call with the matching result', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ kind: 'ready' });
    const result = bridge.call('sum', { a: 1 });
    fromPage({ id: sent[0]!.id, kind: 'result', value: 3 });
    await expect(result).resolves.toBe(3);
  });

  it("passes the caller's origin, as native gave it, to handlers and listeners", async () => {
    const { bridge, connection, sent } = setup();
    const senders: unknown[] = [];
    bridge.handle('who', (_, sender) => senders.push(sender));
    bridge.on('hi', (_, sender) => senders.push(sender));
    const call = { id: 'p1', doc: 'd1', kind: 'call', method: 'who', origin: 'https://evil.test' };
    connection.receive(JSON.stringify(call), 'https://example.com:8443');
    connection.receive(
      JSON.stringify({ doc: 'd1', kind: 'event', method: 'hi' }),
      'https://a.example.com'
    );
    await flush();
    expect(senders).toEqual([
      { origin: 'https://example.com:8443' },
      { origin: 'https://a.example.com' },
    ]);
    expect(sent[0]).toMatchObject({ id: 'p1', kind: 'result' });
  });

  it('rejects a call with the page error', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ kind: 'ready' });
    const result = bridge.call('sum');
    fromPage({ id: sent[0]!.id, kind: 'error', error: { code: 'not_found', message: 'no sum' } });
    await expect(result).rejects.toMatchObject({ code: 'not_found', message: 'no sum' });
  });

  it('times out an unanswered call', async () => {
    jest.useFakeTimers();
    const { bridge, fromPage } = setup(500);
    fromPage({ kind: 'ready' });
    const result = bridge.call('slow');
    jest.advanceTimersByTime(500);
    await expect(result).rejects.toMatchObject({ code: 'timeout' });
  });

  it('takes a per-call timeout, 0 or Infinity for none, clamped to what setTimeout takes', async () => {
    jest.useFakeTimers();
    const { bridge, sent, fromPage } = setup(500);
    fromPage({ kind: 'ready' });
    const short = bridge.call('a', undefined, { timeoutMs: 100 });
    const none = bridge.call('b', undefined, { timeoutMs: 0 });
    const infinite = bridge.call('c', undefined, { timeoutMs: Infinity });
    const huge = bridge.call('d', undefined, { timeoutMs: 2 ** 40 });
    jest.advanceTimersByTime(100);
    await expect(short).rejects.toMatchObject({ code: 'timeout' });
    jest.advanceTimersByTime(60_000);
    for (const [i, call] of [none, infinite, huge].entries()) {
      fromPage({ id: sent[i + 1]!.id, kind: 'result', value: i });
      await expect(call).resolves.toBe(i);
    }
    await expect(bridge.call('e', undefined, { timeoutMs: NaN })).rejects.toThrow(/timeoutMs/);
  });

  it('rejects a bad bridge-wide timeout up front', () => {
    for (const timeoutMs of [NaN, -1, -Infinity])
      expect(() => createBridge({ allowedOrigins: ['*'], timeoutMs })).toThrow(/timeoutMs/);
    expect(() => createBridge({ allowedOrigins: ['*'], timeoutMs: Infinity })).not.toThrow();
  });

  it('throws when attached to a second WebView, and can be attached again after detach', () => {
    const { connection } = setup();
    expect(() => connection.attach(() => {})).toThrow(/already attached/);
    connection.detach();
    expect(() => connection.attach(() => {})).not.toThrow();
  });

  it("does not remove a newer handler when an older one's unsubscribe runs", async () => {
    const { bridge, sent, fromPage } = setup();
    const offOld = bridge.handle('m', () => 'old');
    bridge.handle('m', () => 'new');
    offOld();
    fromPage({ id: 'p1', kind: 'call', method: 'm' });
    await flush();
    expect(sent).toMatchObject([{ id: 'p1', kind: 'result', value: 'new' }]);
  });

  it('answers not_found once a handler is unsubscribed, without running it', async () => {
    const { bridge, sent, fromPage } = setup();
    const handler = jest.fn(() => 'answer');
    const off = bridge.handle('m', handler);
    off();
    fromPage({ id: 'p1', kind: 'call', method: 'm' });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(sent).toMatchObject([
      { id: 'p1', kind: 'error', error: { code: 'not_found', message: 'no handler for m' } },
    ]);
  });

  it('answers handler_error with the text of a thrown non-Error', async () => {
    const { bridge, sent, fromPage } = setup();
    bridge.handle('m', () => {
      // eslint-disable-next-line no-throw-literal -- because a handler can throw anything
      throw 'nope';
    });
    fromPage({ id: 'p1', kind: 'call', method: 'm' });
    await flush();
    expect(sent).toMatchObject([
      { id: 'p1', kind: 'error', error: { code: 'handler_error', message: 'nope' } },
    ]);
  });

  it('rejects calls in flight when a new page becomes ready', async () => {
    const { bridge, fromPage } = setup();
    fromPage({ kind: 'ready' });
    const result = bridge.call('slow');
    fromPage({ kind: 'ready' });
    await expect(result).rejects.toMatchObject({ code: 'navigated' });
  });

  it('rejects calls in flight on detach', async () => {
    const { bridge, connection, fromPage } = setup();
    fromPage({ kind: 'ready' });
    const result = bridge.call('slow');
    connection.detach();
    await expect(result).rejects.toMatchObject({ code: 'navigated' });
  });

  it('answers page calls with the handler result or a structured error', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ kind: 'ready' });
    bridge.handle('echo', (params) => params);
    bridge.handle('fail', () => {
      throw new Error('boom');
    });
    fromPage({ id: 'p1', kind: 'call', method: 'echo', params: { x: 1 } });
    fromPage({ id: 'p2', kind: 'call', method: 'fail' });
    fromPage({ id: 'p3', kind: 'call', method: 'missing' });
    await flush();
    expect([...sent].sort((a, b) => a.id!.localeCompare(b.id!))).toEqual([
      { id: 'p1', doc: 'd1', kind: 'result', value: { x: 1 } },
      {
        id: 'p2',
        doc: 'd1',
        kind: 'error',
        error: { code: 'handler_error', message: 'boom' },
      },
      {
        id: 'p3',
        doc: 'd1',
        kind: 'error',
        error: { code: 'not_found', message: 'no handler for missing' },
      },
    ]);
  });

  it('answers a page call made before the page is ready', async () => {
    const { bridge, sent, fromPage } = setup();
    bridge.handle('echo', (params) => params);
    fromPage({ id: 'p1', kind: 'call', method: 'echo', params: 7 });
    await flush();
    expect(sent).toEqual([{ id: 'p1', doc: 'd1', kind: 'result', value: 7 }]);
  });

  it('delivers page events to listeners until unsubscribed', () => {
    const { bridge, fromPage } = setup();
    const seen: unknown[] = [];
    const off = bridge.on('scrolled', (payload) => seen.push(payload));
    fromPage({ kind: 'event', method: 'scrolled', params: 1 });
    off();
    fromPage({ kind: 'event', method: 'scrolled', params: 2 });
    expect(seen).toEqual([1]);
  });

  it("runs an event's other listeners when one throws, and reports the throw as an unhandled rejection", () => {
    const { bridge, fromPage } = setup();
    const reported: unknown[] = [];
    jest.spyOn(Promise, 'reject').mockImplementation((reason: unknown) => {
      reported.push(reason);
      return new Promise<never>(() => {});
    });
    const seen: number[] = [];
    const failure = new Error('listener failed');
    bridge.on('tick', (payload) => {
      seen.push(payload as number);
      throw failure;
    });
    bridge.on('tick', (payload) => seen.push((payload as number) * 10));
    fromPage({ kind: 'event', method: 'tick', params: 1 });
    jest.restoreAllMocks();
    expect(seen).toEqual([1, 10]);
    expect(reported).toEqual([failure]);
  });

  it('rejects calls immediately once native reports the bridge unavailable', async () => {
    const { bridge, connection } = setup();
    const inFlight = bridge.call('queued');
    connection.markUnavailable();
    await expect(inFlight).rejects.toMatchObject({ code: 'unavailable' });
    await expect(bridge.call('later')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('queues messages after a navigation until the new page is ready', () => {
    const { bridge, connection, sent, fromPage } = setup();
    fromPage({ kind: 'ready' });
    connection.navigated();
    bridge.emit('late', 1);
    expect(sent).toEqual([]);
    fromPage({ kind: 'ready' });
    expect(sent).toEqual([{ doc: 'd1', kind: 'event', method: 'late', params: 1 }]);
  });

  it('sends calls made before the first page to it, without rejecting them', async () => {
    const { bridge, sent, fromPage } = setup();
    const result = bridge.call('early');
    fromPage({ kind: 'ready' });
    expect(sent).toMatchObject([{ kind: 'call', method: 'early' }]);
    fromPage({ id: sent[0]!.id, kind: 'result', value: 7 });
    await expect(result).resolves.toBe(7);
  });

  it('rejects calls posted to a page when it navigates', async () => {
    const { bridge, connection, fromPage } = setup();
    fromPage({ kind: 'ready' });
    const result = bridge.call('slow');
    connection.navigated();
    await expect(result).rejects.toMatchObject({ code: 'navigated' });
  });

  it('does not carry messages queued for a page that never became ready to the next one', async () => {
    const { bridge, connection, sent, fromPage } = setup();
    fromPage({ kind: 'ready' });
    connection.navigated(); // to a page outside allowedOrigins
    bridge.emit('stale', 1);
    const call = bridge.call('stale');
    connection.navigated(); // back to an allowed page
    await expect(call).rejects.toMatchObject({ code: 'navigated' });
    bridge.emit('fresh', 2);
    fromPage({ kind: 'ready' });
    expect(sent).toEqual([{ doc: 'd1', kind: 'event', method: 'fresh', params: 2 }]);
  });

  it('does not send a queued call that already timed out', async () => {
    jest.useFakeTimers();
    const { bridge, sent, fromPage } = setup();
    const result = bridge.call('early');
    jest.runAllTimers();
    await expect(result).rejects.toMatchObject({ code: 'timeout' });
    fromPage({ kind: 'ready' });
    expect(sent).toEqual([]);
  });

  it('rejects the oldest queued call with unavailable when the queue is full', async () => {
    const { bridge, sent, fromPage } = setup(0);
    const first = bridge.call('first');
    for (let i = 0; i < 1000; i++) bridge.emit('event', i);
    await expect(first).rejects.toMatchObject({ code: 'unavailable' });
    fromPage({ kind: 'ready' });
    expect(sent).toHaveLength(1000);
    expect(sent.some((m) => m.kind === 'call')).toBe(false);
  });

  it('drops malformed messages', () => {
    const { bridge, connection } = setup();
    const seen: unknown[] = [];
    bridge.on('x', (payload) => seen.push(payload));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    connection.receive('{"v":1,"kind":"event","method":"x"}', 'https://example.com');
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createBridge document token', () => {
  it("sends to the document that said ready, and answers a page's call with that caller's token", async () => {
    const { bridge, sent, fromPage, connection } = setup();
    bridge.handle('echo', (params) => params);
    fromPage({ id: 'p1', doc: 'early', kind: 'call', method: 'echo', params: 1 }); // before its ready
    await flush();
    bridge.emit('queued', 1);
    fromPage({ doc: 'first', kind: 'ready' });
    connection.navigated();
    bridge.emit('next', 2);
    fromPage({ doc: 'second', kind: 'ready' });
    expect(sent.map((m) => [m.kind, m.doc])).toEqual([
      ['result', 'early'],
      ['event', 'first'],
      ['event', 'second'],
    ]);
  });

  it('drops a page message without a token', () => {
    const { bridge, sent, connection } = setup();
    bridge.emit('hello');
    connection.receive(JSON.stringify({ kind: 'ready' }), 'https://example.com');
    expect(sent).toEqual([]);
  });
});
