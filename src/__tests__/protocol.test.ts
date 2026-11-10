import { parseBridgeMessage } from '../bridge/protocol';

const parse = (value: unknown) => parseBridgeMessage(JSON.stringify(value));

describe('parseBridgeMessage', () => {
  it.each([
    { doc: 'd', kind: 'ready' },
    { doc: 'd', id: '1', kind: 'call', method: 'share', params: { url: 'https://x.ee' } },
    { doc: 'd', id: '1', kind: 'result', value: null },
    { doc: 'd', id: '1', kind: 'result' },
    { doc: 'd', id: '1', kind: 'error', error: { code: 'timeout', message: 'slow' } },
    { doc: 'd', kind: 'event', method: 'scrolled' },
  ])('accepts %j', (message) => {
    expect(parse(message)).toEqual(message);
  });

  it('turns an error code it does not list into handler_error', () => {
    const error = { code: 'E_QUOTA', message: 'full' };
    expect(parse({ doc: 'd', id: '1', kind: 'error', error })).toEqual({
      doc: 'd',
      id: '1',
      kind: 'error',
      error: { code: 'handler_error', message: 'full' },
    });
  });

  it.each([
    ['not JSON', '{', 'not JSON'],
    ['a non-object', '42', 'missing doc'],
    ['null', 'null', 'missing doc'],
    ['a missing doc', JSON.stringify({ kind: 'ready' }), 'missing doc'],
    ['an unknown kind', JSON.stringify({ doc: 'd', id: '1', kind: 'ping' }), 'unknown kind'],
    [
      'a call without id',
      JSON.stringify({ doc: 'd', kind: 'call', method: 'm' }),
      'missing id or method',
    ],
    [
      'a call without method',
      JSON.stringify({ doc: 'd', id: '1', kind: 'call' }),
      'missing id or method',
    ],
    ['a result without id', JSON.stringify({ doc: 'd', kind: 'result' }), 'missing id'],
    [
      'an empty event name',
      JSON.stringify({ doc: 'd', kind: 'event', method: '' }),
      'missing method',
    ],
    [
      'an error without id',
      JSON.stringify({ doc: 'd', kind: 'error', error: { code: 'timeout', message: '' } }),
      'missing id',
    ],
    [
      'a null error',
      JSON.stringify({ doc: 'd', id: '1', kind: 'error', error: null }),
      'malformed error',
    ],
    [
      'a non-string error code',
      JSON.stringify({ doc: 'd', id: '1', kind: 'error', error: { code: 1, message: '' } }),
      'malformed error',
    ],
    [
      'an error without message',
      JSON.stringify({ doc: 'd', id: '1', kind: 'error', error: { code: 'timeout' } }),
      'malformed error',
    ],
  ])('rejects %s', (_name, raw, reason) => {
    expect(parseBridgeMessage(raw)).toBe(reason);
  });
});
