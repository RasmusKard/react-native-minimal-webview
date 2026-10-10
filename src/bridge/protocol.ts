// The bridge wire format. The RN side parses with it; the page client imports only its types.

export const PROTOCOL_VERSION = 1;

const ERROR_CODES = [
  'timeout',
  'not_found', // no handler for the method
  'handler_error', // the handler threw or rejected
  'invalid', // malformed message
  'navigated', // the page navigated or the view went away while the call was pending
  'unavailable', // the platform lacks the needed WebView features
] as const;
export type BridgeErrorCode = (typeof ERROR_CODES)[number];

export type BridgeError = { code: BridgeErrorCode; message: string };

/**
 * `ready`: the page's DOM is parsed (DOMContentLoaded), so its scripts have registered handlers. RN holds its calls and
 * events for the page until then (native can't deliver before the page has posted). A page's own calls and their
 * answers don't wait for it.
 * `call` / `result` / `error`: a request and its answer, matched by `id`.
 * `event`: fire-and-forget, `method` is the event name.
 *
 * `doc` is the page document's random token. The page puts it on every message it sends, and RN puts the token of the
 * document it means on every message it sends: the page drops any message that isn't for it. Native delivers to
 * whatever document is current (iOS checks only the origin), so a message posted as a same-origin navigation commits
 * would otherwise reach the new page. Messages are built without it; `send` adds it.
 */
export type BridgeMessage = { v: 1; id: string; doc?: string } & (
  | { kind: 'ready' }
  | { kind: 'call'; method: string; params?: unknown }
  | { kind: 'result'; params?: unknown }
  | { kind: 'error'; error: BridgeError }
  | { kind: 'event'; method: string; params?: unknown }
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Parses a message from the page, which always carries `doc`.
 * Returns it, or a `BridgeError` saying why it was rejected. Never throws.
 */
export function parseBridgeMessage(raw: string): (BridgeMessage & { doc: string }) | BridgeError {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { code: 'invalid', message: 'not JSON' };
  }
  if (
    !isObject(value) ||
    value['v'] !== PROTOCOL_VERSION ||
    typeof value['id'] !== 'string' ||
    typeof value['doc'] !== 'string'
  ) {
    return { code: 'invalid', message: 'missing v, id or doc' };
  }
  const problem = kindProblem(value);
  return problem
    ? { code: 'invalid', message: problem }
    : (value as BridgeMessage & { doc: string });
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
        (ERROR_CODES as readonly unknown[]).includes(error['code']) &&
        typeof error['message'] === 'string';
      return ok ? null : 'malformed error';
    }
    default:
      return 'unknown kind';
  }
}

export const isBridgeError = (value: BridgeMessage | BridgeError): value is BridgeError =>
  !('kind' in value);
