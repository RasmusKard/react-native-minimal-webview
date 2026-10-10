// The page side of the bridge: installs `window.nativeBridge`. It runs inside the web page, so it imports nothing;
// internal/build-page-client.mjs compiles it to the PAGE_CLIENT string that native injects at document start.
// Transport, a plain pipe each way: page -> native through `postMessage` (iOS WKScriptMessageHandler at
// `webkit.messageHandlers.nativeBridge`, Android addWebMessageListener at `window.nativeBridgeTransport`); native ->
// page through `__receive` (iOS callAsyncJavaScript) or the transport's `onmessage` (Android). Messages follow
// ./protocol.ts, and answers to either side's calls travel as ordinary messages.
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
    messageHandlers?: { nativeBridge?: { postMessage(message: string): void } };
  };
};

/** Installs only on an allowed origin (Android origin-rule format), matching what native accepts. */
export function installPageClient(w: PageWindow, timeoutMs: number, allowedOrigins: string[]) {
  // As OriginRules.swift: test-vectors/origin-rules.json.
  const parse = (text: string) => {
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
  const origin = parse(w.location.origin);
  const allowed = allowedOrigins.some((rule) => {
    const r = parse(rule);
    if (!r || !origin || origin.wildcard) return rule === '*';
    const host = r.wildcard ? origin.host.endsWith(`.${r.host}`) : origin.host === r.host;
    return host && r.scheme === origin.scheme && r.port === origin.port;
  });
  // Main frame only (Android injects into allowed-origin iframes too, but only the main frame's messages are taken).
  if (w.nativeBridge || !allowed || w !== w.top) return;
  const handlers = new Map<string, (params: unknown) => unknown>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  let nextId = 0;
  // Per document: a late answer to a call of the previous page must not match a call of this one.
  const idPrefix = `p${Math.random().toString(36).slice(2, 8)}-`;

  const ios = w.webkit?.messageHandlers?.nativeBridge;
  const android = w.nativeBridgeTransport;

  const send = (message: Message) => {
    const text = JSON.stringify(message);
    (ios ?? android)?.postMessage(text);
  };

  const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

  /** Handles a message from native. Answers to native's calls are sent back as messages. */
  const receive = async (text: string) => {
    const message = JSON.parse(text) as Message;
    if (message.kind === 'result' || message.kind === 'error') {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.kind === 'result') call.resolve(message.params);
      else call.reject(fail(message.error.code, message.error.message));
      return;
    }
    if (message.kind === 'event') {
      listeners.get(message.method)?.forEach((listener) => listener(message.params));
      return;
    }
    if (message.kind !== 'call') return;
    const handler = handlers.get(message.method);
    const failure = (code: 'not_found' | 'handler_error', text: string): Message => ({
      v: 1,
      id: message.id,
      kind: 'error',
      error: { code, message: text },
    });
    let reply = failure('not_found', `no page handler for ${message.method}`);
    if (handler) {
      try {
        reply = { v: 1, id: message.id, kind: 'result', params: await handler(message.params) };
      } catch (error) {
        reply = failure('handler_error', String(error));
      }
    }
    send(reply);
  };

  if (android) android.onmessage = (event) => void receive(event.data);

  w.nativeBridge = Object.freeze({
    call(method: string, params?: unknown): Promise<unknown> {
      const id = `${idPrefix}${++nextId}`;
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
    /** Native entry point for iOS (callAsyncJavaScript, origin-checked there); Android uses the transport's onmessage. */
    __receive: receive,
  });
  // Native can't deliver to the page before it has heard from it.
  send({ v: 1, id: '', kind: 'ready' });
  // Back from the back-forward cache: scripts don't run again, but native reset the bridge when the page was left, and
  // answers to this page's calls went to the page shown meanwhile. Fail those calls and announce the page again.
  w.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(fail('navigated', 'the page was left before the call was answered'));
    }
    pending.clear();
    send({ v: 1, id: '', kind: 'ready' });
  });
}
