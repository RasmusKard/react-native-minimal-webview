import type {
  Bridge,
  BridgeEventMap,
  BridgeMethodMap,
  BridgeOptions,
  BridgeSender,
} from '../types';
import { DEFAULTS } from '../types.defaults';
import { codedError, createEndpoint } from './endpoint';
import { invalidOrigins, originForms } from './origins';
import { MATCHES_ORIGIN, PAGE_CLIENT } from './pageClient.generated';
import { type BridgeMessage, parseBridgeMessage } from './protocol';

/** What `<WebView>` needs from a bridge: `Bridge`'s `[CONNECTION]`, a key the package doesn't export. */
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
  /** A new document committed: queue messages until its page client says `ready`. */
  navigated(): void;
};

export const CONNECTION = Symbol('bridgeConnection');

/**
 * A page-side expression true where `location.origin` matches `origins`, or null when they include `*`. Throws an
 * `Error` starting with `what` for a rule that is neither `*` nor what `parseOrigin` takes.
 */
export function originGuard(what: string, origins: string[]): string | null {
  const invalid = invalidOrigins(origins);
  if (invalid.length) {
    throw new Error(
      `${what} ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
    );
  }
  const forms = originForms(origins);
  return forms.any ? null : `(${MATCHES_ORIGIN})(${JSON.stringify(forms)}, location.origin)`;
}

const MAX_QUEUE = 1000;

/**
 * Creates a {@link Bridge} to the pages of `allowedOrigins`, for one WebView's `bridge` prop.
 *
 * The type arguments type the method names, params, results and event payloads of `call`, `handle`, `emit` and `on`;
 * nothing checks them at runtime, so a handler still validates what an untrusted page sends. Throws an `Error` for an
 * invalid origin rule or timeout.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export function createBridge<
  Methods extends BridgeMethodMap = BridgeMethodMap,
  Events extends BridgeEventMap = BridgeEventMap,
>(options: BridgeOptions): Bridge<Methods, Events> {
  // `*` or what origins.ts parses: addWebMessageListener's rules minus custom schemes.
  const guard = originGuard('createBridge: invalid allowedOrigins', options.allowedOrigins);
  const timeoutMs = options.timeoutMs ?? DEFAULTS.BridgeOptions.timeoutMs;
  if (!(timeoutMs >= 0)) {
    throw new Error(
      `createBridge: timeoutMs must be 0 or more (0 or Infinity for none), not ${timeoutMs}`
    );
  }
  let post: ((message: string) => void) | null = null;
  // idle: no document committed since attach. loading: one committed and hasn't said `ready` yet.
  let phase: 'idle' | 'loading' | 'ready' = 'idle';
  // The token of the document that last said `ready` (protocol.ts `doc`).
  let doc: string | undefined;
  // Messages for the next document that says `ready`. Only the latest document's: see navigated().
  let queue: BridgeMessage[] = [];
  let unavailable = false;

  const deliver = (message: BridgeMessage) => {
    post?.(JSON.stringify({ ...message, doc }));
    if (message.kind === 'call') {
      const call = endpoint.pending.get(message.id);
      if (call) call.sent = true;
    }
  };

  const endpoint = createEndpoint<BridgeSender>(
    (message) => {
      if (post && phase === 'ready') deliver(message);
      else {
        queue.push(message);
        const dropped = queue.length > MAX_QUEUE ? queue.shift() : undefined;
        if (dropped?.kind === 'call') {
          const call = endpoint.pending.get(dropped.id);
          endpoint.rejectPending('unavailable', 'the bridge queue was full', (pending) => pending === call);
        }
      }
    },
    timeoutMs,
    'n'
  );

  const rejectSent = (message: string) =>
    endpoint.rejectPending('navigated', message, (call) => call.sent);
  const unavailableMessage =
    'this WebView lacks the features the bridge needs; update Android System WebView';

  const receive = (text: string, origin: string) => {
    const message = parseBridgeMessage(text);
    if (typeof message === 'string') {
      if (__DEV__) console.warn(`[react-native-minimal-webview] dropped a bridge message: ${message}`);
      return;
    }
    if (message.kind !== 'ready') {
      // Answers skip the ready queue: a module script may await one before DOMContentLoaded, and native can deliver
      // it, as the page has posted.
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
    script: `${guard ? `if (${guard}) ` : ''}(${PAGE_CLIENT})(window, ${Number(timeoutMs)});`,
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
        return Promise.reject(codedError({ code: 'unavailable', message: unavailableMessage }));
      return endpoint.call(method, params, callOptions);
    },
    emit: endpoint.emit,
    on: endpoint.on,
    [CONNECTION]: connection,
  } as Bridge as Bridge<Methods, Events>;
}
