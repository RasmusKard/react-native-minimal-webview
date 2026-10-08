// The page side of the bridge: installs `window.nativeBridge`. It runs inside the web page, so it imports nothing;
// internal/build-page-client.mjs compiles it to the PAGE_CLIENT string that native injects at document start.
// Transports: iOS WKScriptMessageHandlerWithReply (`webkit.messageHandlers.nativeBridge`), Android
// addWebMessageListener (`window.nativeBridgeTransport`). Messages follow ./protocol.ts.
import type { BridgeMessage as Message } from './protocol';


type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PageWindow = Window & {
  nativeBridge?: unknown;
  nativeBridgeTransport?: {
    postMessage(message: string): void;
    onmessage: ((event: { data: string }) => void) | null;
  };
  webkit?: {
    messageHandlers?: { nativeBridge?: { postMessage(message: string): Promise<string | null> } };
  };
};

/** Installs only on an allowed origin (Android origin-rule format), matching what native accepts. */
export function installPageClient(w: PageWindow, timeoutMs: number, allowedOrigins: string[]) {
  const origin = w.location.origin;
  const allowed = allowedOrigins.some((rule) => {
    const [scheme, wildcardHost] = rule.split('://*.');
    return wildcardHost === undefined
      ? rule === '*' || rule === origin
      : origin.startsWith(`${scheme}://`) && origin.endsWith(`.${wildcardHost}`);
  });
  if (w.nativeBridge || !allowed) return;
  const handlers = new Map<string, (params: unknown) => unknown>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  let nextId = 0;

  const ios = w.webkit?.messageHandlers?.nativeBridge;
  const android = w.nativeBridgeTransport;

  const send = (message: Message) => {
    const text = JSON.stringify(message);
    if (ios) {
      // A reply (if any) is the answer to a call this page made.
      void ios.postMessage(text).then((reply) => reply && receive(reply));
    } else {
      android?.postMessage(text);
    }
  };

  const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

  /** Handles a message from native. Returns the reply for calls, which iOS passes back to the caller. */
  const receive = async (text: string): Promise<string | null> => {
    const message = JSON.parse(text) as Message;
    if (message.kind === 'result' || message.kind === 'error') {
      const call = pending.get(message.id);
      if (!call) return null;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.kind === 'result') call.resolve(message.params);
      else call.reject(fail(message.error.code, message.error.message));
      return null;
    }
    if (message.kind === 'event') {
      listeners.get(message.method)?.forEach((listener) => listener(message.params));
      return null;
    }
    if (message.kind !== 'call') return null;
    const handler = handlers.get(message.method);
    let reply: Message;
    if (!handler) {
      reply = {
        v: 1,
        id: message.id,
        kind: 'error',
        error: { code: 'not_found', message: `no page handler for ${message.method}` },
      };
    } else {
      try {
        reply = { v: 1, id: message.id, kind: 'result', params: await handler(message.params) };
      } catch (error) {
        reply = {
          v: 1,
          id: message.id,
          kind: 'error',
          error: { code: 'handler_error', message: String(error) },
        };
      }
    }
    if (ios) return JSON.stringify(reply);
    send(reply);
    return null;
  };

  if (android) android.onmessage = (event) => void receive(event.data);

  w.nativeBridge = Object.freeze({
    call(method: string, params?: unknown): Promise<unknown> {
      const id = `p${++nextId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(fail('timeout', `${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        send({ v: 1, id, kind: 'call', method, params });
      });
    },
    emit(event: string, payload?: unknown) {
      send({ v: 1, id: '', kind: 'event', method: event, params: payload });
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
    /** Native entry point for iOS (callAsyncJavaScript); Android uses the transport's onmessage. */
    __receive: receive,
  });
  // Android needs one page message before native can reply.
  send({ v: 1, id: '', kind: 'ready' });
}
