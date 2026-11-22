import type { ErrorCode } from '../types';

const ERROR_CODES = [
  'timeout',
  'not_found',
  'handler_error',
  'navigated',
  'unavailable',
] as const satisfies readonly ErrorCode[];
export type BridgeErrorCode = (typeof ERROR_CODES)[number];

/**
 * `ready`: the page's DOM is parsed (DOMContentLoaded), so its scripts have registered handlers. RN holds its calls and
 * events for the page until then (native can't deliver before the page has posted). A page's own calls and their
 * answers don't wait for it.
 * `call` / `result` / `error`: a request and its answer, matched by `id`.
 * `event`: fire-and-forget.
 *
 * `doc` is the page document's random token. Each side puts a token on every message (RN the token of the document it
 * means), and the page drops any message that isn't for it: native delivers to whatever document is current (iOS
 * checks only the origin), so a message posted as a same-origin navigation commits would otherwise reach the new page.
 * It is for correctness, not security: an allowed page can rebind its own client.
 */
export type BridgeMessage = { doc?: string } & (
  | { kind: 'ready' }
  | { kind: 'call'; id: string; method: string; params?: unknown }
  | { kind: 'result'; id: string; value?: unknown }
  | { kind: 'error'; id: string; error: { code: BridgeErrorCode; message: string } }
  | { kind: 'event'; event: string; params?: unknown }
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Parses a message from the page, which always carries `doc`. Returns it, or the reason it was rejected. Never throws.
 * An error `code` that isn't a `BridgeErrorCode` becomes `handler_error`: the page's handler failed somehow.
 */
export function parseBridgeMessage(raw: string): (BridgeMessage & { doc: string }) | string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'not JSON';
  }
  if (!isObject(value) || typeof value['doc'] !== 'string') return 'missing doc';
  const problem = kindProblem(value);
  if (problem) return problem;
  const message = value as BridgeMessage & { doc: string };
  return message.kind === 'error' && !ERROR_CODES.includes(message.error.code)
    ? { ...message, error: { ...message.error, code: 'handler_error' } }
    : message;
}

const isName = (value: unknown) => typeof value === 'string' && value !== '';

function kindProblem(value: Record<string, unknown>): string | null {
  const hasId = typeof value['id'] === 'string';
  switch (value['kind']) {
    case 'ready':
      return null;
    case 'event':
      return isName(value['event']) ? null : 'missing event';
    case 'call':
      return hasId && isName(value['method']) ? null : 'missing id or method';
    case 'result':
      return hasId ? null : 'missing id';
    case 'error':
      return !hasId ? 'missing id' : isError(value['error']) ? null : 'malformed error';
    default:
      return 'unknown kind';
  }
}

const isError = (error: unknown) =>
  isObject(error) && typeof error['code'] === 'string' && typeof error['message'] === 'string';
