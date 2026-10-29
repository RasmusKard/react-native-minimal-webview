// One side of the bridge, the same in RN (createBridge.ts) and in the page (pageClient.ts): calls with timeouts,
// handlers and events, and the origin rules (parser, validator, matcher). The transport, the `ready` handshake and the
// document tokens are each side's own. The page client is compiled with this file into one script
// (.github/scripts/build-page-client.mts), so it imports only types.
import type { BridgeErrorCode, BridgeMessage } from './protocol';

/**
 * An origin rule (`http(s)://host[:port]`, `http(s)://*.host[:port]`) or a `location.origin`, parsed; null for anything
 * else, `*` included. OriginRules.swift matches the same way: both run src/__tests__/vectors/origin-rules.json.
 */
export const parseOrigin = (text: string) => {
  const m =
    /^(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(
      text.toLowerCase()
    );
  return (
    m && {
      scheme: m[1],
      wildcard: !!m[2],
      host: m[3]!,
      port: +(m[4] ?? (m[1] === 'https' ? 443 : 80)),
    }
  );
};

/** The rules that are neither `*` nor what `parseOrigin` takes. */
export const invalidOrigins = (rules: string[]) =>
  rules.filter((rule) => rule !== '*' && !parseOrigin(rule));

/** Origin rules in `location.origin` form, for `matchesOrigin`: exact origins, and wildcards as prefix and suffix. */
export type OriginForms = { any: boolean; exact: string[]; wild: [string, string][] };

/** `rules` in the form `matchesOrigin` compares; a rule `parseOrigin` rejects is left out, so it matches nothing. */
export const originForms = (rules: string[]): OriginForms => {
  const forms: OriginForms = { any: rules.includes('*'), exact: [], wild: [] };
  for (const rule of rules) {
    const r = parseOrigin(rule);
    if (!r) continue;
    const rest = r.host + (r.port === (r.scheme === 'https' ? 443 : 80) ? '' : `:${r.port}`);
    if (r.wildcard) forms.wild.push([`${r.scheme}://`, `.${rest}`]);
    else forms.exact.push(`${r.scheme}://${rest}`);
  }
  return forms;
};

/** Whether `text` holds `part` at index `at`, compared character by character. */
function hasAt(text: string, part: string, at: number) {
  for (let k = 0; k < part.length; k++) if (text[at + k] !== part[k]) return false;
  return true;
}

/**
 * Whether `origin`, as `location.origin` serializes it, matches `forms`. Only `===`, indexing and `length`, no
 * built-in method: it runs at document start in frames whose built-ins another same-origin frame may have patched.
 */
export function matchesOrigin(forms: OriginForms, origin: string) {
  if (forms.any) return true;
  for (let i = 0; i < forms.exact.length; i++) if (forms.exact[i] === origin) return true;
  for (let i = 0; i < forms.wild.length; i++) {
    const prefix = forms.wild[i]![0];
    const suffix = forms.wild[i]![1];
    const start = origin.length - suffix.length;
    // At least one character of subdomain between the two.
    if (start > prefix.length && hasAt(origin, prefix, 0) && hasAt(origin, suffix, start))
      return true;
  }
  return false;
}

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Posted to a document, not just queued for the next one (RN). */
  sent: boolean;
};

/** A `CodedError` (types.ts): what a ref method or bridge call rejects with. */
export const codedError = ({ code, message }: { code: ErrorCode; message: string }) =>
  Object.assign(new Error(message), { code });

/**
 * `send` posts a message to the other side; ids get `idPrefix`, so the two sides' calls never share an id. `Sender` is
 * what handlers and listeners get beside the params: RN's `{ origin }`, nothing in the page.
 */
export function createEndpoint<Sender = void>(
  send: (message: BridgeMessage) => void,
  timeoutMs: number,
  idPrefix: string
) {
  const handlers = new Map<string, (params: unknown, sender: Sender) => unknown>();
  const listeners = new Map<string, Set<(payload: unknown, sender: Sender) => void>>();
  const pending = new Map<string, Pending>();
  let nextId = 0;

  return {
    pending,
    call(method: string, params?: unknown, options?: { timeoutMs?: number }) {
      const ms = options?.timeoutMs ?? timeoutMs;
      if (!(ms >= 0))
        return Promise.reject(new RangeError(`${method}: timeoutMs must be 0 or more, not ${ms}`));
      const id = `${idPrefix}${++nextId}`;
      return new Promise<unknown>((resolve, reject) => {
        // Clamped: setTimeout fires at once for a delay above 2^31-1.
        const timer =
          ms > 0 && ms < Infinity
            ? setTimeout(
                () => {
                  pending.delete(id);
                  reject(
                    codedError({ code: 'timeout', message: `${method} timed out after ${ms} ms` })
                  );
                },
                Math.min(ms, 2 ** 31 - 1)
              )
            : undefined;
        pending.set(id, { resolve, reject, timer, sent: false });
        send({ id, kind: 'call', method, params });
      });
    },
    emit(event: string, payload?: unknown) {
      send({ kind: 'event', method: event, params: payload });
    },
    handle(method: string, handler: (params: unknown, sender: Sender) => unknown) {
      handlers.set(method, handler);
      return () => {
        if (handlers.get(method) === handler) handlers.delete(method);
      };
    },
    on(event: string, listener: (payload: unknown, sender: Sender) => void) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set.add(listener));
      return () => set.delete(listener);
    },
    /** Rejects the calls in flight, or only those `only` picks. */
    rejectPending(code: BridgeErrorCode, message: string, only?: (call: Pending) => boolean) {
      for (const [id, call] of pending) {
        if (only && !only(call)) continue;
        clearTimeout(call.timer);
        call.reject(codedError({ code, message }));
        pending.delete(id);
      }
    },
    /** A message from the other side: settles a call, fires an event, or answers a call through `reply`. */
    async receive(message: BridgeMessage, reply: (message: BridgeMessage) => void, sender: Sender) {
      switch (message.kind) {
        case 'call': {
          const { id, method } = message;
          const fail = (code: BridgeErrorCode, text: string) =>
            reply({ id, kind: 'error', error: { code, message: text } });
          const handler = handlers.get(method);
          if (!handler) return fail('not_found', `no handler for ${method}`);
          try {
            reply({ id, kind: 'result', value: await handler(message.params, sender) });
          } catch (error) {
            fail('handler_error', error instanceof Error ? error.message : String(error));
          }
          return;
        }
        case 'event':
          listeners.get(message.method)?.forEach((listener) => listener(message.params, sender));
          return;
        case 'result':
        case 'error': {
          const call = pending.get(message.id);
          if (!call) return;
          pending.delete(message.id);
          clearTimeout(call.timer);
          if (message.kind === 'result') call.resolve(message.value);
          else call.reject(codedError(message.error));
        }
      }
    },
  };
}
