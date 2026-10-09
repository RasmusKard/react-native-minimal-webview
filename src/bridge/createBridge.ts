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
  /** Posted to a document (not just queued for the next one). */
  sent: boolean;
};

const MAX_QUEUE = 1000;

const bridgeError = ({ code, message }: BridgeError) => Object.assign(new Error(message), { code });

/** Creates a promise-based RPC channel to `window.nativeBridge`. Attach it to one `<WebView bridge={...}>`. */
/** `*`, `http(s)://host[:port]` or `http(s)://*.host[:port]`: addWebMessageListener's rules minus custom schemes. */
const ORIGIN_RULE =
  /^(\*|https?:\/\/(\*\.(?!\[))?([a-z0-9_-]+(\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?)$/i;

export function createBridge(options: BridgeOptions): Bridge {
  const invalid = options.allowedOrigins.filter((rule) => !ORIGIN_RULE.test(rule));
  if (invalid.length) {
    throw new Error(
      `createBridge: invalid allowedOrigins ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const handlers = new Map<string, BridgeHandler>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  let post: ((message: string) => void) | null = null;
  let ready = false;
  // Messages for the next document that says `ready`. Only the latest document's: see navigated().
  let queue: { id: string; text: string; call: boolean }[] = [];
  // A document committed and hasn't said `ready` yet.
  let awaitingReady = false;
  let nextId = 0;
  let unavailable = false;

  const deliver = (id: string, text: string) => {
    post?.(text);
    const call = pending.get(id);
    if (call) call.sent = true;
  };

  const send = (message: BridgeMessage) => {
    const text = JSON.stringify(message);
    if (post && ready) deliver(message.id, text);
    else {
      queue.push({ id: message.id, text, call: message.kind === 'call' });
      // ponytail: drop-oldest cap for a page that never becomes ready; a dropped call still times out
      if (queue.length > MAX_QUEUE) queue.shift();
    }
  };

  /** Rejects calls in flight (by default because their page is gone): all, or only those already posted to a page. */
  const rejectAll = (
    message: string,
    code: BridgeError['code'] = 'navigated',
    onlySent = false
  ) => {
    for (const [id, call] of pending) {
      if (onlySent && !call.sent) continue;
      clearTimeout(call.timer);
      call.reject(bridgeError({ code, message }));
      pending.delete(id);
    }
  };
  const unavailableMessage =
    'this WebView lacks the features the bridge needs; update Android System WebView';

  const answer = async (id: string, method: string, params: unknown) => {
    const fail = (code: BridgeError['code'], message: string) =>
      send({ v: 1, id, kind: 'error', error: { code, message } });
    const handler = handlers.get(method);
    if (!handler) return fail('not_found', `no handler for ${method}`);
    try {
      send({ v: 1, id, kind: 'result', params: await handler(params) });
    } catch (error) {
      fail('handler_error', String(error));
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
      case 'ready': {
        // A new document: calls posted to the previous one can no longer be answered. Queued ones are for this one.
        rejectAll('the page navigated', 'navigated', true);
        ready = true;
        awaitingReady = false;
        const flushing = queue;
        queue = [];
        // A queued call that already timed out is not sent: nobody waits for its answer.
        for (const { id, text, call } of flushing) if (!call || pending.has(id)) deliver(id, text);
        break;
      }
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
      awaitingReady = false;
      queue = [];
      rejectAll('the WebView went away');
    },
    receive,
    navigated() {
      rejectAll('the page navigated', 'navigated', true);
      // The previous document never said `ready` (a page outside allowedOrigins): what was queued for it does not
      // carry over to an unrelated next one.
      if (awaitingReady) {
        rejectAll('the page navigated before the bridge was ready');
        queue = [];
      }
      ready = false;
      awaitingReady = true;
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
      if (unavailable)
        return Promise.reject(bridgeError({ code: 'unavailable', message: unavailableMessage }));
      const id = `n${++nextId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            bridgeError({ code: 'timeout', message: `${method} timed out after ${timeoutMs} ms` })
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, sent: false });
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
