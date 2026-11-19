import type { Bridge, BridgeOptions, BridgeSchema, BridgeSender, SchemaOf } from '../types';
import { DEFAULTS } from '../types.defaults';
import { codedError, createEndpoint } from './endpoint';
import { originGuard } from './origins';
import { PAGE_CLIENT } from './pageClient.generated';
import { type BridgeMessage, parseBridgeMessage } from './protocol';

/**
 * What native reports to the bridge: a page's message with its origin as native verified it (`location.origin` form);
 * a new document committed, so messages queue until its page client says `ready`; or the platform lacks the WebView
 * features the bridge needs, so calls reject with `unavailable`.
 */
export type BridgeEvent =
  { message: string; origin: string } | { navigated: true } | { unavailable: true };

/** What `<WebView>` needs from a bridge: `Bridge`'s `[CONNECTION]`, a key the package doesn't export. */
export type BridgeConnection = {
  allowedOrigins: string[];
  /** The page client to inject at document start. */
  script: string;
  attach(post: (message: string) => void): void;
  detach(): void;
  receive(event: BridgeEvent): void;
};

export const CONNECTION = Symbol('bridgeConnection');

const MAX_QUEUE = 1000;

/**
 * Creates a {@link Bridge} to the pages of `allowedOrigins`, for one WebView's `bridge` prop.
 *
 * The type argument, a {@link BridgeSchema}, types the methods and events of `handle`, `call`, `emit` and `on`.
 * Nothing checks them at runtime, so a handler still validates what an untrusted page sends. Throws an `Error` for an
 * invalid origin rule or timeout.
 * @see [Bridge example](https://rasmuskard.github.io/react-native-minimal-webview/guides/examples/#the-bridge)
 * @group Bridge
 */
export function createBridge<Schema extends SchemaOf<Schema> = BridgeSchema>(
  options: BridgeOptions
): Bridge<Schema> {
  // The rule syntax is addWebMessageListener's, minus custom schemes.
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
  // Messages for the next document that says `ready`. Only the latest document's: see `receive`.
  let queue: BridgeMessage[] = [];
  let unavailable = false;

  const deliver = (message: BridgeMessage) => post?.(JSON.stringify({ ...message, doc }));

  const endpoint = createEndpoint<BridgeSender>(
    (message) => {
      if (post && phase === 'ready') deliver(message);
      else {
        // Throws now, at the caller, for what JSON can't encode, rather than in the flush, losing the rest of the queue.
        JSON.stringify(message);
        queue.push(message);
        const dropped = queue.length > MAX_QUEUE ? queue.shift() : undefined;
        if (dropped?.kind === 'call')
          endpoint.rejectPending(
            'unavailable',
            'the bridge queue was full',
            (id) => id === dropped.id
          );
      }
    },
    timeoutMs,
    'n'
  );

  // A pending call not in the queue was posted to a document.
  const rejectSent = (message: string) => {
    const queued = new Set(
      queue.map((queuedMessage) => queuedMessage.kind === 'call' && queuedMessage.id)
    );
    endpoint.rejectPending('navigated', message, (id) => !queued.has(id));
  };
  const unavailableMessage =
    'this WebView lacks the features the bridge needs; update Android System WebView';

  const receiveMessage = (text: string, origin: string) => {
    const message = parseBridgeMessage(text);
    if (typeof message === 'string') {
      if (__DEV__)
        console.warn(`[react-native-minimal-webview] dropped a bridge message: ${message}`);
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
    receive(event) {
      if ('message' in event) receiveMessage(event.message, event.origin);
      else if ('unavailable' in event) {
        unavailable = true;
        queue = [];
        endpoint.rejectPending('unavailable', unavailableMessage);
      } else {
        rejectSent('the page navigated');
        // The previous document never said `ready` (a page outside allowedOrigins): what was queued for it does not
        // carry over to an unrelated next one.
        if (phase === 'loading') {
          endpoint.rejectPending('navigated', 'the page navigated before the bridge was ready');
          queue = [];
        }
        phase = 'loading';
      }
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
  } as Bridge as unknown as Bridge<Schema>; // the schema types only what callers pass
}
