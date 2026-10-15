import { isBridgeError, parseBridgeMessage } from '../bridge/protocol';

const parse = (value: unknown) => parseBridgeMessage(JSON.stringify(value));

describe('parseBridgeMessage', () => {
  it.each([
    { doc: 'd', id: '', kind: 'ready' },
    { doc: 'd', id: '1', kind: 'call', method: 'share', params: { url: 'https://x.ee' } },
    { doc: 'd', id: '1', kind: 'result', params: null },
    { doc: 'd', id: '1', kind: 'result' },
    { doc: 'd', id: '1', kind: 'error', error: { code: 'timeout', message: 'slow' } },
    { doc: 'd', id: '', kind: 'event', method: 'scrolled' },
  ])('accepts %j', (message) => {
    expect(parse(message)).toEqual(message);
  });

  it.each([
    ['not JSON', '{', 'invalid'],
    ['a non-object', '42', 'invalid'],
    ['a missing doc', JSON.stringify({ id: '', kind: 'ready' }), 'invalid'],
    ['a missing id', JSON.stringify({ doc: 'd', kind: 'ready' }), 'invalid'],
    ['an unknown kind', JSON.stringify({ doc: 'd', id: '1', kind: 'ping' }), 'invalid'],
    ['a call without method', JSON.stringify({ doc: 'd', id: '1', kind: 'call' }), 'invalid'],
    [
      'an empty method',
      JSON.stringify({ doc: 'd', id: '1', kind: 'event', method: '' }),
      'invalid',
    ],
    [
      'an unknown error code',
      JSON.stringify({
        doc: 'd',
        id: '1',
        kind: 'error',
        error: { code: 'boom', message: '' },
      }),
      'invalid',
    ],
    [
      'an error without message',
      JSON.stringify({ doc: 'd', id: '1', kind: 'error', error: { code: 'timeout' } }),
      'invalid',
    ],
  ])('rejects %s', (_name, raw, code) => {
    const result = parseBridgeMessage(raw);
    expect(isBridgeError(result) && result.code).toBe(code);
  });
});
