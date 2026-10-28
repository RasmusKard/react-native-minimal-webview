// The bridge wire format. The RN side parses with it; the page client imports only its types.

const ERROR_CODES = ['timeout', 'not_found', 'handler_error', 'navigated', 'unavailable'] as const;
/**
 * Why a bridge call rejected.
 *
 * - `timeout`: no answer in time.
 * - `not_found`: no handler for the method.
 * - `handler_error`: the handler threw or rejected (the `message` is its error's), or the page sent a code not listed
 *   here.
 * - `navigated`: the page navigated or crashed, or the WebView unmounted, while the call was pending.
 * - `unavailable`: the WebView lacks the features the bridge needs (Android System WebView older than 101).
 * @useDeclaredType
 * @group Bridge
 */
export type BridgeErrorCode = (typeof ERROR_CODES)[number];

/**
 * `ready`: the page's DOM is parsed (DOMContentLoaded), so its scripts have registered handlers. RN holds its calls and
 * events for the page until then (native can't deliver before the page has posted). A page's own calls and their
 * answers don't wait for it.
 * `call` / `result` / `error`: a request and its answer, matched by `id`.
 * `event`: fire-and-forget, `method` is the event name.
 *
 * `doc` is the page document's random token. Each side puts a token on every message (RN the token of the document it
 * means), and the page drops any message that isn't for it: native delivers to whatever document is current (iOS
 * checks only the origin), so a message posted as a same-origin navigation commits would otherwise reach the new page.
 * It is for correctness, not security: an allowed page can rebind its own client. Messages are built without it;
 * `send` adds it.
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
