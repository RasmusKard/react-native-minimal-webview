import { Platform } from 'react-native';
import { seams } from 'sample-extension';

import {
  errorCode,
  fresh,
  idle,
  openPage,
  pageCall,
  sleep,
  waitFor,
  poll,
  quietFor,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter, withFloor } from '../harness/runner';
import { OTHER } from '../pages';

export async function bridge(h: Harness, all: Reporter) {
  const r = withFloor(all, WEBVIEW.bridge);
  const page = fresh(h, '/bridge.html');
  await openPage(h, page);
  const bridgeType = await h.ref.current?.evaluate(
    '[typeof window.nativeBridge, location.href, document.readyState]'
  );
  r.check('page sees window.nativeBridge', (bridgeType as string[])?.[0] === 'object', {
    bridgeType,
    state: h.state(),
  });

  const evaluate = (script: string) => h.ref.current?.evaluate(script);
  const plain = await evaluate(`({ n: 1 + 1, s: 'x', a: [true, null] })`);
  r.since(
    WEBVIEW.evaluate,
    'evaluate returns a plain value',
    JSON.stringify(plain) === '{"n":2,"s":"x","a":[true,null]}',
    plain
  );
  const awaited = await evaluate(
    `new Promise((resolve) => setTimeout(() => resolve('late'), 300))`
  );
  r.since(WEBVIEW.evaluate, 'evaluate awaits a Promise', awaited === 'late', awaited);
  const unencodable = await Promise.all(
    ['() => 1', 'NaN', '(() => { const o = {}; o.o = o; return o; })()'].map(evaluate)
  );
  r.since(
    WEBVIEW.evaluate,
    'evaluate gives null for what JSON cannot encode',
    unencodable.every((v) => v === null),
    unencodable
  );
  const thrown = (await Promise.all(
    [`(() => { throw new Error('boom'); })()`, `Promise.reject(new Error('no'))`, '1 +'].map((s) =>
      evaluate(s)?.catch((e: unknown) => ({ code: errorCode(e), message: (e as Error).message }))
    )
  )) as ({ code?: string; message: string } | undefined)[];
  r.since(
    WEBVIEW.evaluate,
    'evaluate rejects script_error on a throw, a rejection or a syntax error',
    thrown.every((c) => c?.code === 'script_error'),
    thrown
  );
  r.since(
    WEBVIEW.evaluate,
    "evaluate rejects with the thrown error's message",
    String(thrown[0]?.message).includes('boom'),
    thrown[0]
  );

  const sum = await h.bridge.call('sum', { a: 2, b: 3 }).catch(errorCode);
  r.check('RN -> page call', sum === 5, sum);
  const slowPage = await h.bridge.call('pageSlow').catch(errorCode);
  r.check('RN -> page awaits a page Promise', slowPage === 'late', slowPage);
  const missing = await h.bridge.call('nope').catch(errorCode);
  r.check('RN -> page missing method rejects not_found', missing === 'not_found', missing);

  const echo = await pageCall(h, 'echo', { x: 1, s: 'quote\' "' });
  const echoed = echo.result as { x?: number; s?: string } | undefined;
  r.check('page -> RN call', echoed?.x === 1 && echoed.s === 'quote\' "', echo);
  const failed = await pageCall(h, 'fail', null);
  r.check('page -> RN handler error', failed.error === 'handler_error', failed);
  const notFound = await pageCall(h, 'nope', null);
  r.check('page -> RN missing method', notFound.error === 'not_found', notFound);
  const slow = await pageCall(h, 'slow', null);
  r.check('page -> RN call times out', slow.error === 'timeout', slow);
  const unhandle = h.bridge.handle('sender', (_, sender) => sender);
  const sender = await pageCall(h, 'sender', null);
  unhandle();
  r.check(
    "page -> RN handler gets the caller's origin from native",
    (sender.result as { origin?: string } | undefined)?.origin === h.pages,
    sender
  );

  h.bridge.emit('nativeEvent', { n: 1 });
  const logged = await poll(
    () => h.ref.current?.evaluate(`window.testLog.some((line) => line.startsWith('nativeEvent'))`),
    3000
  );
  r.check('RN -> page event', logged === true);
  const before = h.pageEvents.length;
  await h.ref.current?.evaluate(`nativeBridge.emit('pageEvent', { n: 2 })`).catch(errorCode);
  await waitFor(h, () => h.pageEvents.length > before, 3000);
  await quietFor(200);
  r.check('page -> RN event', h.pageEvents.length === before + 1, h.pageEvents);

  const inFlight = h.bridge.call('pageSlow').catch(errorCode);
  const pending = evaluate('new Promise(() => {})')?.catch(errorCode);
  await sleep(200);
  h.load(`${page}&next=1`);
  const cutOff = await inFlight;
  r.check('navigation rejects calls in flight', cutOff === 'navigated', cutOff);
  const gone = await pending;
  r.since(WEBVIEW.evaluate, 'navigation rejects an evaluate in flight', gone === 'navigated', gone);
  await waitFor(h, (s) => s.url.includes('next=1') && idle(s));
  const again = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('the bridge works again after navigation', again === 2, again);

  await openPage(h, `${page}&callFromHead=1`);
  const headCall = await poll(() => h.ref.current?.evaluate('window.__head'), 5000);
  r.check(
    "a head script's call at document start is answered",
    (headCall as { result?: { head?: boolean } } | undefined)?.result?.head === true,
    headCall
  );
  const afterHead = await h.bridge.call('sum', { a: 2, b: 2 }).catch(errorCode);
  r.check("RN -> page calls work after a head script's call", afterHead === 4, afterHead);

  if (Platform.OS === 'android') {
    await seams.busyMainInSlices(3000);
    await openPage(h, `${page}&callFromHead=1&busy=1`);
    const busyHead = await poll(() => h.ref.current?.evaluate('window.__head'), 5000);
    r.check(
      "a head script's call is answered when the main thread is busy at the commit",
      (busyHead as { result?: { head?: boolean } } | undefined)?.result?.head === true,
      busyHead
    );
    const afterBusy = await h.bridge.call('sum', { a: 3, b: 3 }).catch(errorCode);
    r.check(
      'RN -> page calls work after a commit the main thread was busy at',
      afterBusy === 6,
      afterBusy
    );
  }

  if (Platform.OS === 'android') {
    await openPage(h, `${page}&answerOnHide=1`);
    const untilHide = h.bridge.call('untilHide', undefined, { timeoutMs: 8000 }).catch(errorCode);
    await sleep(300);
    h.load(`${page}&left=1`);
    const hidden = await untilHide;
    r.check('an answer the page sends as it is left settles the call', hidden === 'hidden', hidden);
    await waitFor(h, (s) => s.url.includes('left=1') && idle(s));

    for (let i = 0; i < 3; i++) {
      const target = `${OTHER}/bridge.html?redirected=${i}&t=${Date.now()}`;
      h.load(`${page}&redirectTo=${encodeURIComponent(target)}&holdMs=1500&i=${i}`);
      await sleep(700);
      await seams.busyMainAhead(2500);
      await waitFor(h, (s) => s.url === target && idle(s), 15000);
      const queued = h.bridge.call('sum', { a: 1, b: 1 }, { timeoutMs: 20000 }).catch(errorCode);
      await sleep(300);
      h.load(`${page}&after=${i}`);
      const got = await queued;
      r.check(
        `a call after a ready page redirects outside allowedOrigins waits for a page (${i})`,
        got === 'unavailable',
        got
      );
      await waitFor(h, (s) => s.url.includes(`after=${i}`) && idle(s));
    }
  }

  const lateHandler = `${page}&lateHandler=1`;
  h.load(lateHandler);
  await waitFor(h, (s) => s.url === lateHandler);
  const duringLoad = await h.bridge.call('early').catch(errorCode);
  r.check(
    'a call made during load reaches a handler the page registers while loading',
    duringLoad === 'early-ok',
    duringLoad
  );
  await waitFor(h, idle);

  const other = fresh(h, `${OTHER}/bridge.html`);
  await openPage(h, other);
  r.check(
    'no bridge for an origin outside allowedOrigins',
    (await h.ref.current?.evaluate('typeof window.nativeBridge')) === 'undefined'
  );
  const blocked = await h.bridge.call('sum', { a: 1, b: 1 }).catch(errorCode);
  r.check('calls to a disallowed page time out', blocked === 'timeout', blocked);

  if (Platform.OS === 'ios') {
    const unmounted = evaluate('new Promise(() => {})')?.catch(errorCode);
    await sleep(200);
    h.remount();
    const closed = await Promise.race([unmounted, sleep(3000).then(() => 'still pending')]);
    r.check('unmount rejects an evaluate in flight', closed === 'navigated', closed);
  }
}
