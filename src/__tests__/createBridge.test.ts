import { type BridgeConnection, CONNECTION, createBridge } from '../bridge/createBridge';
import type { BridgeMessage } from '../bridge/protocol';
import type { Bridge } from '../types';

function setup(timeoutMs = 1000) {
  const bridge = createBridge({ allowedOrigins: ['https://example.com'], timeoutMs });
  const connection = (bridge as Bridge & { [CONNECTION]: BridgeConnection })[CONNECTION];
  const sent: BridgeMessage[] = [];
  connection.attach((text) => sent.push(JSON.parse(text) as BridgeMessage));
  const fromPage = (message: object) => connection.receive(JSON.stringify({ v: 1, ...message }));
  return { bridge, connection, sent, fromPage };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createBridge', () => {
  afterEach(() => jest.useRealTimers());

  it('injects the page client with its timeout and origins', () => {
    const { connection } = setup(2500);
    expect(connection.script).toMatch(/^\(function installPageClient\(/);
    expect(connection.script).toMatch(/\)\(window, 2500, \["https:\/\/example.com"\]\);$/);
  });

  it('queues messages until the page is ready', () => {
    const { bridge, sent, fromPage } = setup();
    bridge.emit('hello', 1);
    expect(sent).toEqual([]);
    fromPage({ id: '', kind: 'ready' });
    expect(sent).toEqual([{ v: 1, id: '', kind: 'event', method: 'hello', params: 1 }]);
  });

  it('resolves a call with the matching result', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    const result = bridge.call('sum', { a: 1 });
    fromPage({ id: sent[0]!.id, kind: 'result', params: 3 });
    await expect(result).resolves.toBe(3);
  });

  it('rejects a call with the page error', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    const result = bridge.call('sum');
    fromPage({ id: sent[0]!.id, kind: 'error', error: { code: 'not_found', message: 'no sum' } });
    await expect(result).rejects.toMatchObject({ code: 'not_found', message: 'no sum' });
  });

  it('times out an unanswered call', async () => {
    jest.useFakeTimers();
    const { bridge, fromPage } = setup(500);
    fromPage({ id: '', kind: 'ready' });
    const result = bridge.call('slow');
    jest.advanceTimersByTime(500);
    await expect(result).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects calls in flight when a new page becomes ready', async () => {
    const { bridge, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    const result = bridge.call('slow');
    fromPage({ id: '', kind: 'ready' });
    await expect(result).rejects.toMatchObject({ code: 'navigated' });
  });

  it('rejects calls in flight on detach', async () => {
    const { bridge, connection, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    const result = bridge.call('slow');
    connection.detach();
    await expect(result).rejects.toMatchObject({ code: 'navigated' });
  });

  it('answers page calls with the handler result or a structured error', async () => {
    const { bridge, sent, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    bridge.handle('echo', (params) => params);
    bridge.handle('fail', () => {
      throw new Error('boom');
    });
    fromPage({ id: 'p1', kind: 'call', method: 'echo', params: { x: 1 } });
    fromPage({ id: 'p2', kind: 'call', method: 'fail' });
    fromPage({ id: 'p3', kind: 'call', method: 'missing' });
    await flush();
    expect([...sent].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { v: 1, id: 'p1', kind: 'result', params: { x: 1 } },
      { v: 1, id: 'p2', kind: 'error', error: { code: 'handler_error', message: 'Error: boom' } },
      {
        v: 1,
        id: 'p3',
        kind: 'error',
        error: { code: 'not_found', message: 'no handler for missing' },
      },
    ]);
  });

  it('delivers page events to listeners until unsubscribed', () => {
    const { bridge, fromPage } = setup();
    const seen: unknown[] = [];
    const off = bridge.on('scrolled', (payload) => seen.push(payload));
    fromPage({ id: '', kind: 'event', method: 'scrolled', params: 1 });
    off();
    fromPage({ id: '', kind: 'event', method: 'scrolled', params: 2 });
    expect(seen).toEqual([1]);
  });

  it('rejects calls immediately once native reports the bridge unavailable', async () => {
    const { bridge, connection } = setup();
    const inFlight = bridge.call('queued');
    connection.markUnavailable();
    await expect(inFlight).rejects.toMatchObject({ code: 'unavailable' });
    await expect(bridge.call('later')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects malformed allowedOrigins up front', () => {
    expect(() => createBridge({ allowedOrigins: ['https://example.com/'] })).toThrow(/invalid allowedOrigins/);
    expect(() => createBridge({ allowedOrigins: ['example.com'] })).toThrow(/invalid allowedOrigins/);
    expect(() =>
      createBridge({ allowedOrigins: ['*', 'https://*.example.com', 'http://localhost:8090'] })
    ).not.toThrow();
  });

  it('queues messages after a navigation until the new page is ready', () => {
    const { bridge, connection, sent, fromPage } = setup();
    fromPage({ id: '', kind: 'ready' });
    connection.navigated();
    bridge.emit('late', 1);
    expect(sent).toEqual([]);
    fromPage({ id: '', kind: 'ready' });
    expect(sent).toEqual([{ v: 1, id: '', kind: 'event', method: 'late', params: 1 }]);
  });

  it('drops malformed messages', () => {
    const { bridge, connection } = setup();
    const seen: unknown[] = [];
    bridge.on('x', (payload) => seen.push(payload));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    connection.receive('{"v":1,"kind":"event","method":"x"}');
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
