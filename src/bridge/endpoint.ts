import type { CodedError, ErrorCode } from '../types';
import type { BridgeErrorCode, BridgeMessage } from './protocol';

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export const codedError = ({ code, message }: { code: ErrorCode; message: string }): CodedError =>
  Object.assign(new Error(message), { code });

/**
 * `send` posts a message to the other side; ids get `idPrefix`, so the two sides' calls never share an id.
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
        pending.set(id, { resolve, reject, timer });
        try {
          send({ id, kind: 'call', method, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          throw error;
        }
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
    rejectPending(code: BridgeErrorCode, message: string, only?: (id: string) => boolean) {
      for (const [id, call] of pending) {
        if (only && !only(id)) continue;
        clearTimeout(call.timer);
        call.reject(codedError({ code, message }));
        pending.delete(id);
      }
    },
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
          listeners.get(message.method)?.forEach((listener) => {
            try {
              listener(message.params, sender);
            } catch (error) {
              void Promise.reject(error);
            }
          });
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
