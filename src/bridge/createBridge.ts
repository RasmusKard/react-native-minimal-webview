import type { Bridge, BridgeHandler, BridgeOptions } from '../types';
import { PAGE_CLIENT } from './pageClient.generated';
import {
  type BridgeError,
  type BridgeMessage,
  isBridgeError,
  parseBridgeMessage,
} from './protocol';

const DEFAULT_TIMEOUT_MS = 10_000;

/** What `<WebView>` needs from a bridge; not part of the public type. */
export type BridgeConnection = {
  allowedOrigins: string[];
  /** The page client to inject at document start. */
  script: string;
  attach(post: (message: string) => void): void;
  detach(): void;
  receive(message: string): void;
  /** The platform lacks the WebView features the bridge needs: calls reject with `unavailable`. */
  markUnavailable(): void;
  /** A new document committed: queue messages until its page client says `ready`. */
  navigated(): void;
};

export const CONNECTION = Symbol('bridgeConnection');

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

const bridgeError = ({ code, message }: BridgeError) => Object.assign(new Error(message), { code });

/** Creates a promise-based RPC channel to `window.nativeBridge`. Attach it to one `<WebView bridge={...}>`. */
/** `*`, `scheme://host[:port]` or `scheme://*.host[:port]`, as Android's addWebMessageListener accepts. */
const ORIGIN_RULE = /^(\*|[a-z][a-z0-9+.-]*:\/\/(\*\.)?[^/:*?#\s]+(:\d+)?)$/i;

export function createBridge(options: BridgeOptions): Bridge {
  const invalid = options.allowedOrigins.filter((rule) => !ORIGIN_RULE.test(rule));
  if (invalid.length) {
    throw new Error(`createBridge: invalid allowedOrigins ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const handlers = new Map<string, BridgeHandler>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  let post: ((message: string) => void) | null = null;
  let ready = false;
  let queue: string[] = [];
  let nextId = 0;
  let unavailable = false;

  const send = (message: BridgeMessage) => {
    const text = JSON.stringify(message);
    if (post && ready) post(text);
    else queue.push(text);
  };

  /** Rejects every call in flight, by default because their page is gone. */
  const rejectAll = (message: string, code: BridgeError['code'] = 'navigated') => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(bridgeError({ code, message }));
    }
    pending.clear();
  };
  const unavailableMessage = 'this WebView lacks the features the bridge needs; update Android System WebView';

  const answer = async (id: string, method: string, params: unknown) => {
    const handler = handlers.get(method);
    if (!handler) {
      send({
        v: 1,
        id,
        kind: 'error',
        error: { code: 'not_found', message: `no handler for ${method}` },
      });
      return;
    }
    try {
      send({ v: 1, id, kind: 'result', params: await handler(params) });
    } catch (error) {
      send({ v: 1, id, kind: 'error', error: { code: 'handler_error', message: String(error) } });
    }
  };

  const receive = (text: string) => {
    const message = parseBridgeMessage(text);
    if (isBridgeError(message)) {
      if (__DEV__)
        console.warn(`[react-native-minimal-webview] dropped a bridge message: ${message.message}`);
      return;
    }
    switch (message.kind) {
      case 'ready':
        // A new document: calls made to the previous one can no longer be answered.
        rejectAll('the page navigated');
        ready = true;
        queue.forEach((queued) => post?.(queued));
        queue = [];
        break;
      case 'call':
        void answer(message.id, message.method, message.params);
        break;
      case 'event':
        listeners.get(message.method)?.forEach((listener) => listener(message.params));
        break;
      default: {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.kind === 'result') call.resolve(message.params);
        else call.reject(bridgeError(message.error));
      }
    }
  };

  const connection: BridgeConnection = {
    allowedOrigins: options.allowedOrigins,
    script: `(${PAGE_CLIENT})(window, ${Number(timeoutMs)}, ${JSON.stringify(options.allowedOrigins)});`,
    attach(next) {
      post = next;
    },
    detach() {
      post = null;
      ready = false;
      queue = [];
      rejectAll('the WebView went away');
    },
    receive,
    navigated() {
      ready = false;
    },
    markUnavailable() {
      unavailable = true;
      queue = [];
      rejectAll(unavailableMessage, 'unavailable');
    },
  };

  return {
    handle(method, handler) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    call(method, params) {
      if (unavailable) return Promise.reject(bridgeError({ code: 'unavailable', message: unavailableMessage }));
      const id = `n${++nextId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            bridgeError({ code: 'timeout', message: `${method} timed out after ${timeoutMs} ms` })
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        send({ v: 1, id, kind: 'call', method, params });
      });
    },
    emit(event, payload) {
      send({ v: 1, id: '', kind: 'event', method: event, params: payload });
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set.add(listener));
      return () => set.delete(listener);
    },
    [CONNECTION]: connection,
  } as Bridge;
}
