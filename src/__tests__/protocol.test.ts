import { isBridgeError, parseBridgeMessage } from '../bridge/protocol';

const parse = (value: unknown) => parseBridgeMessage(JSON.stringify(value));

describe('parseBridgeMessage', () => {
  it.each([
    { v: 1, doc: 'd', id: '', kind: 'ready' },
    { v: 1, doc: 'd', id: '1', kind: 'call', method: 'share', params: { url: 'https://x.ee' } },
    { v: 1, doc: 'd', id: '1', kind: 'result', params: null },
    { v: 1, doc: 'd', id: '1', kind: 'result' },
    { v: 1, doc: 'd', id: '1', kind: 'error', error: { code: 'timeout', message: 'slow' } },
    { v: 1, doc: 'd', id: '', kind: 'event', method: 'scrolled' },
  ])('accepts %j', (message) => {
    expect(parse(message)).toEqual(message);
  });

  it.each([
    ['not JSON', '{', 'invalid'],
    ['a non-object', '42', 'invalid'],
    ['another version', JSON.stringify({ v: 2, doc: 'd', id: '1', kind: 'ready' }), 'invalid'],
    ['a missing doc', JSON.stringify({ v: 1, id: '', kind: 'ready' }), 'invalid'],
    ['a missing id', JSON.stringify({ v: 1, doc: 'd', kind: 'ready' }), 'invalid'],
    ['an unknown kind', JSON.stringify({ v: 1, doc: 'd', id: '1', kind: 'ping' }), 'invalid'],
    ['a call without method', JSON.stringify({ v: 1, doc: 'd', id: '1', kind: 'call' }), 'invalid'],
    [
      'an empty method',
      JSON.stringify({ v: 1, doc: 'd', id: '1', kind: 'event', method: '' }),
      'invalid',
    ],
    [
      'an unknown error code',
      JSON.stringify({
        v: 1,
        doc: 'd',
        id: '1',
        kind: 'error',
        error: { code: 'boom', message: '' },
      }),
      'invalid',
    ],
    [
      'an error without message',
      JSON.stringify({ v: 1, doc: 'd', id: '1', kind: 'error', error: { code: 'timeout' } }),
      'invalid',
    ],
  ])('rejects %s', (_name, raw, code) => {
    const result = parseBridgeMessage(raw);
    expect(isBridgeError(result) && result.code).toBe(code);
  });
});
