// The bridge wire format. The RN side parses with it; the page client imports only its types.

const ERROR_CODES = [
  'timeout',
  'not_found', // no handler for the method
  'handler_error', // the handler threw or rejected; also any code from the page that isn't listed here
  'navigated', // the page navigated or the view went away while the call was pending
  'unavailable', // the platform lacks the needed WebView features
] as const;
export type BridgeErrorCode = (typeof ERROR_CODES)[number];

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
export type BridgeMessage = { doc?: string } & (
  | { kind: 'ready' }
  | { kind: 'call'; id: string; method: string; params?: unknown }
  | { kind: 'result'; id: string; value?: unknown }
  | { kind: 'error'; id: string; error: { code: BridgeErrorCode; message: string } }
  | { kind: 'event'; method: string; params?: unknown }
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Parses a message from the page, which always carries `doc`. Returns it, or the reason it was rejected. Never throws.
 * An error `code` that isn't a {@link BridgeErrorCode} becomes `handler_error`: the page's handler failed somehow.
 */
export function parseBridgeMessage(raw: string): (BridgeMessage & { doc: string }) | string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'not JSON';
  }
  if (!isObject(value) || typeof value['doc'] !== 'string') return 'missing doc';
  return kindProblem(value) ?? (value as BridgeMessage & { doc: string });
}

function kindProblem(value: Record<string, unknown>): string | null {
  const hasId = typeof value['id'] === 'string';
  const hasMethod = typeof value['method'] === 'string' && value['method'] !== '';
  switch (value['kind']) {
    case 'ready':
      return null;
    case 'event':
      return hasMethod ? null : 'missing method';
    case 'call':
      return hasId && hasMethod ? null : 'missing id or method';
    case 'result':
      return hasId ? null : 'missing id';
    case 'error':
      return !hasId ? 'missing id' : normalizeError(value['error']) ? null : 'malformed error';
    default:
      return 'unknown kind';
  }
}

/** Whether `error` is `{ code, message }`, both strings; an unlisted code is replaced in place. */
function normalizeError(error: unknown) {
  if (!isObject(error) || typeof error['code'] !== 'string' || typeof error['message'] !== 'string')
    return false;
  if (!(ERROR_CODES as readonly string[]).includes(error['code'])) error['code'] = 'handler_error';
  return true;
}
