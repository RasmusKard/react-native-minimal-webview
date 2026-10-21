import type { Bridge, BridgeEventMap, BridgeMethodMap, BridgeOptions, BridgeSender } from '../types';
import { bridgeError, createEndpoint, parseOrigin } from './endpoint';
import { PAGE_CLIENT } from './pageClient.generated';
import { type BridgeMessage, parseBridgeMessage } from './protocol';

const DEFAULT_TIMEOUT_MS = 10_000;

/** What `<WebView>` needs from a bridge; not part of the public type. */
export type BridgeConnection = {
  allowedOrigins: string[];
  /** The page client to inject at document start. */
  script: string;
  attach(post: (message: string) => void): void;
  detach(): void;
  /** A message from the page, and its origin as native verified it. */
  receive(message: string, origin: string): void;
  /** The platform lacks the WebView features the bridge needs: calls reject with `unavailable`. */
  markUnavailable(): void;
  /** A new document committed: queue messages until its page client says `ready` (at DOMContentLoaded). */
  navigated(): void;
};

export const CONNECTION = Symbol('bridgeConnection');

const MAX_QUEUE = 1000;

/**
 * Creates a promise-based RPC channel to `window.nativeBridge`. Attach it to one `<WebView bridge={...}>`. The type
 * arguments only type `call`, `handle`, `emit` and `on`; nothing checks them at runtime.
 */
export function createBridge<
  Methods extends BridgeMethodMap = BridgeMethodMap,
  Events extends BridgeEventMap = BridgeEventMap,
>(options: BridgeOptions): Bridge<Methods, Events> {
  // `*` or what the page client parses: addWebMessageListener's rules minus custom schemes.
  const invalid = options.allowedOrigins.filter((rule) => rule !== '*' && !parseOrigin(rule));
  if (invalid.length) {
    throw new Error(
      `createBridge: invalid allowedOrigins ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!(timeoutMs >= 0)) {
    throw new Error(
      `createBridge: timeoutMs must be 0 or more (0 or Infinity for none), not ${timeoutMs}`
    );
  }
  let post: ((message: string) => void) | null = null;
  // idle: no document committed since attach. loading: one committed and hasn't said `ready` yet.
  let phase: 'idle' | 'loading' | 'ready' = 'idle';
  // The token of the document that last said `ready` (protocol.ts `doc`): what RN sends is for that document only.
  let doc: string | undefined;
  // Messages for the next document that says `ready`. Only the latest document's: see navigated().
  let queue: BridgeMessage[] = [];
  let unavailable = false;

  const deliver = (message: BridgeMessage) => {
    post?.(JSON.stringify({ ...message, doc }));
    const call = message.kind === 'call' && endpoint.pending.get(message.id);
    if (call) call.sent = true;
  };

  const endpoint = createEndpoint<BridgeSender>(
    (message) => {
      if (post && phase === 'ready') deliver(message);
      else {
        queue.push(message);
        // ponytail: drop-oldest cap for a page that never becomes ready; a dropped call still times out
        if (queue.length > MAX_QUEUE) queue.shift();
      }
    },
    timeoutMs,
    'n'
  );

  /** Rejects the calls already posted to a page that is gone. */
  const rejectSent = (message: string) =>
    endpoint.rejectPending('navigated', message, (call) => call.sent);
  const unavailableMessage =
    'this WebView lacks the features the bridge needs; update Android System WebView';

  const receive = (text: string, origin: string) => {
    const message = parseBridgeMessage(text);
    if (typeof message === 'string') {
      if (__DEV__) console.warn(`[minimal-rn-webview] dropped a bridge message: ${message}`);
      return;
    }
    if (message.kind !== 'ready') {
      // Answers go out at once, not through the ready-gated queue: the page may be waiting for this answer before it
      // reaches DOMContentLoaded (a module script awaiting a call), and `ready` is sent only then. Native can deliver
      // it: the page's call is a message from that page. It carries the caller's token, so only that document takes it.
      const reply = (answer: BridgeMessage) =>
        post?.(JSON.stringify({ ...answer, doc: message.doc }));
      void endpoint.receive(message, reply, { origin });
      return;
    }
    // A new document: calls posted to the previous one can no longer be answered. Queued ones are for this one.
    rejectSent('the page navigated');
    phase = 'ready';
    doc = message.doc;
    const flushing = queue;
    queue = [];
    // A queued call that already timed out is not sent: nobody waits for its answer.
    for (const queued of flushing)
      if (queued.kind !== 'call' || endpoint.pending.has(queued.id)) deliver(queued);
  };

  const connection: BridgeConnection = {
    allowedOrigins: options.allowedOrigins,
    script: `(${PAGE_CLIENT})(window, ${Number(timeoutMs)}, ${JSON.stringify(options.allowedOrigins)});`,
    attach(next) {
      // Two WebViews would steal each other's replies, and either one's detach would cut off the other.
      if (post)
        throw new Error(
          'createBridge: this bridge is already attached to a mounted WebView; give each WebView its own bridge'
        );
      post = next;
    },
    detach() {
      post = null;
      phase = 'idle';
      queue = [];
      endpoint.rejectPending('navigated', 'the WebView went away');
    },
    receive,
    navigated() {
      rejectSent('the page navigated');
      // The previous document never said `ready` (a page outside allowedOrigins): what was queued for it does not
      // carry over to an unrelated next one.
      if (phase === 'loading') {
        endpoint.rejectPending('navigated', 'the page navigated before the bridge was ready');
        queue = [];
      }
      phase = 'loading';
    },
    markUnavailable() {
      unavailable = true;
      queue = [];
      endpoint.rejectPending('unavailable', unavailableMessage);
    },
  };

  return {
    handle: endpoint.handle,
    call(method, params, callOptions) {
      if (unavailable)
        return Promise.reject(bridgeError({ code: 'unavailable', message: unavailableMessage }));
      return endpoint.call(method, params, callOptions);
    },
    emit: endpoint.emit,
    on: endpoint.on,
    [CONNECTION]: connection,
  } as Bridge as Bridge<Methods, Events>;
}
