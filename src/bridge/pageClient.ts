import type { PageBridge } from '../types';
import { createEndpoint } from './endpoint';
import type { BridgeMessage as Message } from './protocol';

type PageWindow = Window & {
  nativeBridge?: PageBridge & { __receive(text: string): Promise<void> };
  nativeBridgeTransport?: {
    postMessage(message: string): void;
    onmessage: ((event: { data: string }) => void) | null;
  };
  webkit?: {
    messageHandlers?: { nativeBridge?: { postMessage(message: string): void } };
  };
};

export function installPageClient(w: PageWindow, timeoutMs: number) {
  // Android injects into allowed-origin iframes too.
  if (w.nativeBridge || w !== w.top) return;
  const doc = Math.random().toString(36).slice(2, 10);

  const ios = w.webkit?.messageHandlers?.nativeBridge;
  const android = w.nativeBridgeTransport;

  const send = (message: Message) => {
    const text = JSON.stringify({ ...message, doc });
    (ios ?? android)?.postMessage(text);
  };
  const endpoint = createEndpoint(send, timeoutMs, 'p');

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
    __receive: receive,
  });
  if (w.document.readyState === 'loading') {
    w.document.addEventListener('DOMContentLoaded', () => send({ kind: 'ready' }), {
      once: true,
    });
  } else {
    send({ kind: 'ready' });
  }
  // A page restored from the back-forward cache does not run its scripts again.
  w.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    endpoint.rejectPending('navigated', 'the page was left before the call was answered');
    send({ kind: 'ready' });
  });
}
