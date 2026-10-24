// The page side of the bridge: installs `window.nativeBridge`. It runs inside the web page, so
// .github/scripts/build-page-client.mts compiles it, with ./endpoint.ts, into the PAGE_CLIENT string that native
// injects at document start. Each direction is a plain pipe: page -> native through `postMessage` (iOS
// WKScriptMessageHandler at `webkit.messageHandlers.nativeBridge`, Android addWebMessageListener at
// `window.nativeBridgeTransport`), native -> page through `__receive` (iOS callAsyncJavaScript) or the transport's
// `onmessage` (Android). Messages follow ./protocol.ts; answers to either side's calls travel as ordinary messages.
import { createEndpoint, parseOrigin } from './endpoint';
import type { BridgeMessage as Message } from './protocol';

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
  const origin = parseOrigin(w.location.origin);
  const allowed = allowedOrigins.some((rule) => {
    const r = parseOrigin(rule);
    if (!r || !origin || origin.wildcard) return rule === '*';
    const host = r.wildcard ? origin.host.endsWith(`.${r.host}`) : origin.host === r.host;
    return host && r.scheme === origin.scheme && r.port === origin.port;
  });
  // Main frame only (Android injects into allowed-origin iframes too, but only the main frame's messages are taken).
  if (w.nativeBridge || !allowed || w !== w.top) return;
  // This document's token (protocol.ts `doc`): a message for another document, like a late answer to a call of the
  // previous page, is dropped.
  const doc = Math.random().toString(36).slice(2, 10);

  const ios = w.webkit?.messageHandlers?.nativeBridge;
  const android = w.nativeBridgeTransport;

  const send = (message: Message) => {
    const text = JSON.stringify({ ...message, doc });
    (ios ?? android)?.postMessage(text);
  };
  const endpoint = createEndpoint(send, timeoutMs, 'p');

  /** Answers to native's calls go back through `send`, as messages. */
  const receive = async (text: string) => {
    const message = JSON.parse(text) as Message;
    if (message.doc === doc) await endpoint.receive(message, send);
  };

  if (android) android.onmessage = (event) => void receive(event.data);

  w.nativeBridge = Object.freeze({
    call: endpoint.call,
    emit: endpoint.emit,
    handle: endpoint.handle,
    on: endpoint.on,
    /** iOS's entry point (callAsyncJavaScript, origin-checked there); Android uses the transport's onmessage. */
    __receive: receive,
  });
  // `ready` tells RN to deliver what it queued for this page (native can't deliver before the page has posted). Wait
  // for DOMContentLoaded, so the page's synchronous and deferred scripts have registered their handlers and listeners;
  // a call delivered earlier would get `not_found`. The page's own calls work before that: RN answers them at once.
  if (w.document.readyState === 'loading') {
    w.document.addEventListener('DOMContentLoaded', () => send({ kind: 'ready' }), {
      once: true,
    });
  } else {
    send({ kind: 'ready' });
  }
  // Back from the back-forward cache: scripts don't run again, but native reset the bridge when the page was left, and
  // answers to this page's calls went to the page shown meanwhile. Fail those calls and announce the page again.
  w.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    endpoint.rejectPending('navigated', 'the page was left before the call was answered');
    send({ kind: 'ready' });
  });
}
