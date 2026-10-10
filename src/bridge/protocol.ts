// The bridge wire format, shared by the RN side and the page client (compiled into it at build time).

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1_000_000;

export type BridgeErrorCode =
  | 'timeout'
  | 'not_found' // no handler for the method
  | 'handler_error' // the handler threw or rejected
  | 'invalid' // malformed message
  | 'too_large'
  | 'navigated' // the page navigated or the view went away while the call was pending
  | 'unavailable'; // the platform lacks the needed WebView features

export type BridgeError = { code: BridgeErrorCode; message: string };

/**
 * `ready`: the page client is installed (Android needs one page message before it can reply).
 * `call` / `result` / `error`: a request and its answer, matched by `id`.
 * `event`: fire-and-forget, `method` is the event name.
 */
export type BridgeMessage =
  | { v: 1; id: string; kind: 'ready' }
  | { v: 1; id: string; kind: 'call'; method: string; params?: unknown }
  | { v: 1; id: string; kind: 'result'; params?: unknown }
  | { v: 1; id: string; kind: 'error'; error: BridgeError }
  | { v: 1; id: string; kind: 'event'; method: string; params?: unknown };

const ERROR_CODES = new Set<string>([
  'timeout',
  'not_found',
  'handler_error',
  'invalid',
  'too_large',
  'navigated',
  'unavailable',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Returns the message, or a `BridgeError` saying why it was rejected. Never throws. */
export function parseBridgeMessage(raw: string): BridgeMessage | BridgeError {
  // UTF-16 length is a cheap upper bound proxy: one code unit is at most 3 UTF-8 bytes.
  if (raw.length > MAX_MESSAGE_BYTES)
    return { code: 'too_large', message: `message over ${MAX_MESSAGE_BYTES} bytes` };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { code: 'invalid', message: 'not JSON' };
  }
  if (!isObject(value) || value['v'] !== PROTOCOL_VERSION || typeof value['id'] !== 'string') {
    return { code: 'invalid', message: 'missing v or id' };
  }
  const problem = kindProblem(value);
  return problem ? { code: 'invalid', message: problem } : (value as BridgeMessage);
}

function kindProblem(value: Record<string, unknown>): string | null {
  switch (value['kind']) {
    case 'ready':
    case 'result':
      return null;
    case 'call':
    case 'event':
      return typeof value['method'] === 'string' && value['method'] !== ''
        ? null
        : 'missing method';
    case 'error': {
      const error = value['error'];
      const ok =
        isObject(error) &&
        ERROR_CODES.has(error['code'] as string) &&
        typeof error['message'] === 'string';
      return ok ? null : 'malformed error';
    }
    default:
      return 'unknown kind';
  }
}

export const isBridgeError = (value: BridgeMessage | BridgeError): value is BridgeError =>
  !('kind' in value);
