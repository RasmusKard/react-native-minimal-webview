// One side of the bridge, the same in RN (createBridge.ts) and in the page (pageClient.ts): calls with timeouts,
// handlers and events. The transport, the `ready` handshake and the document tokens are each side's own. The page
// client is compiled with this file into one script (.github/scripts/build-page-client.mjs), so it imports only types.
import type { BridgeError, BridgeMessage } from './protocol';

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  /** Posted to a document, not just queued for the next one (RN). */
  sent: boolean;
};

/** An `Error` whose `code` is a {@link BridgeError} code. */
export const bridgeError = ({ code, message }: BridgeError) =>
  Object.assign(new Error(message), { code });

/** `send` posts a message to the other side; ids get `idPrefix`, so the two sides' calls never share an id. */
export function createEndpoint(
  send: (message: BridgeMessage) => void,
  timeoutMs: number,
  idPrefix: string
) {
  const handlers = new Map<string, (params: unknown) => unknown>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  let nextId = 0;

  return {
    pending,
    call(method: string, params?: unknown) {
      const id = `${idPrefix}${++nextId}`;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            bridgeError({ code: 'timeout', message: `${method} timed out after ${timeoutMs} ms` })
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, sent: false });
        send({ id, kind: 'call', method, params });
      });
    },
    emit(event: string, payload?: unknown) {
      send({ id: '', kind: 'event', method: event, params: payload });
    },
    handle(method: string, handler: (params: unknown) => unknown) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    on(event: string, listener: (payload: unknown) => void) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set.add(listener));
      return () => set.delete(listener);
    },
    /** Rejects the calls in flight, or only those `only` picks. */
    rejectPending(code: BridgeError['code'], message: string, only?: (call: Pending) => boolean) {
      for (const [id, call] of pending) {
        if (only && !only(call)) continue;
        clearTimeout(call.timer);
        call.reject(bridgeError({ code, message }));
        pending.delete(id);
      }
    },
    /** A message from the other side: settles a call, fires an event, or answers a call through `reply`. */
    async receive(message: BridgeMessage, reply: (message: BridgeMessage) => void) {
      switch (message.kind) {
        case 'call': {
          const { id, method } = message;
          const fail = (code: BridgeError['code'], text: string) =>
            reply({ id, kind: 'error', error: { code, message: text } });
          const handler = handlers.get(method);
          if (!handler) return fail('not_found', `no handler for ${method}`);
          try {
            reply({ id, kind: 'result', params: await handler(message.params) });
          } catch (error) {
            fail('handler_error', String(error));
          }
          return;
        }
        case 'event':
          listeners.get(message.method)?.forEach((listener) => listener(message.params));
          return;
        case 'result':
        case 'error': {
          const call = pending.get(message.id);
          if (!call) return;
          pending.delete(message.id);
          clearTimeout(call.timer);
          if (message.kind === 'result') call.resolve(message.params);
          else call.reject(bridgeError(message.error));
        }
      }
    },
  };
}
