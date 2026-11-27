import { Platform } from 'react-native';

import {
  clearEvents,
  fresh,
  idle,
  nextEntry,
  openPage,
  poll,
  sleep,
  waitFor,
  happens,
} from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';
import { HTTPS } from '../pages';

export async function errors(h: Harness, r: Reporter) {
  await openPage(h, fresh(h, '/'));
  /** Runs `act`, then waits for the next load to end: its outcome, or 'no end' after `ms`. */
  const outcomeOf = async (act: () => unknown, ms = 10000) =>
    (await nextEntry(h.events.outcomes, act, undefined, ms)) ?? 'no end';

  clearEvents(h);
  const unreachable = 'http://localhost:8099/nothing';
  h.loadSource({ uri: unreachable });
  const gotNetwork = await happens(waitFor(h, () => h.events.errors.length > 0, 10000));
  await waitFor(h, idle, 5000);
  await sleep(500);
  const network = h.events.errors[0];
  r.check('network error', gotNetwork && network?.kind === 'network', network);
  r.check('url is the failed url', h.state().url === unreachable, h.state());
  r.check(
    'onLoadEnd of a failed load has the failed url',
    h.events.loadEnds[0]?.url === unreachable,
    h.events.loadEnds
  );
  r.check(
    'a failed load ends once, as failed',
    JSON.stringify(h.events.outcomes) === '["failed"]',
    { loads: h.events.loads, outcomes: h.events.outcomes }
  );
  r.check(
    'the error screen is shown after a failure',
    await happens(waitFor(h, () => h.events.overlay.error, 3000))
  );

  clearEvents(h);
  const notFound = await outcomeOf(() => h.loadSource({ uri: fresh(h, '/status/404') }));
  await waitFor(h, () => h.events.errors.length > 0, 3000);
  const http = h.events.errors[0];
  r.check(
    'http error with the status code',
    http?.kind === 'http' && http.statusCode === 404,
    http
  );
  r.check('an http error is the only error', h.events.errors.length === 1, h.events.errors);
  r.check('a 404 page ends as finished', notFound === 'finished', notFound);
  r.check(
    'the error screen goes away on the next load',
    await happens(waitFor(h, () => !h.events.overlay.error, 3000))
  );

  clearEvents(h);
  await openPage(h, fresh(h, '/subresource-404.html'));
  await sleep(1000);
  r.check('subresource 404s are not reported', h.events.errors.length === 0, h.events.errors);
  r.check(
    'a clean load ends as finished',
    JSON.stringify(h.events.outcomes) === '["finished"]',
    h.events.outcomes
  );

  const stopped = await outcomeOf(async () => {
    h.loadSource({ uri: fresh(h, '/slow?ms=3000') });
    await poll(() => h.state().loading, 1000, 50);
    h.ref.current?.stopLoading();
  }, 5000);
  r.since(
    WEBVIEW.navigationListener,
    'a stopped load ends as cancelled',
    stopped === 'cancelled',
    stopped
  );
  clearEvents(h);
  h.loadSource({ uri: fresh(h, '/slow?ms=3000') });
  await poll(() => h.state().loading, 1000, 50);
  const newer = fresh(h, '/');
  h.loadSource({ uri: newer });
  await waitFor(h, (s) => s.url === newer && idle(s), 10000);
  await sleep(500);
  const replaced = JSON.stringify({ loads: h.events.loads, outcomes: h.events.outcomes });
  const expectedReplaced =
    Platform.OS === 'ios'
      ? '{"loads":["start","end"],"outcomes":["finished"]}'
      : '{"loads":["start","end","start","end"],"outcomes":["cancelled","finished"]}';
  r.since(
    WEBVIEW.navigationListener,
    'a load replaced before it commits',
    replaced === expectedReplaced,
    replaced
  );
  const noContent = await outcomeOf(() => h.loadSource({ uri: fresh(h, '/status/204') }), 5000);
  const expected204 =
    Platform.OS === 'ios' && parseFloat(String(Platform.Version)) < 26.2 ? 'finished' : 'cancelled';
  r.since(
    WEBVIEW.navigationListener,
    `a 204 ends as ${expected204}`,
    noContent === expected204,
    noContent
  );
  h.setRules([
    { path: ['/blocked'], action: 'block' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const blocked = await outcomeOf(
    () => h.ref.current?.evaluate(`location.href = '/redirect?to=/blocked'`),
    5000
  );
  r.since(
    WEBVIEW.navigationListener,
    'a redirect the rules block ends as cancelled',
    blocked === 'cancelled',
    blocked
  );
  h.setRules(undefined);

  clearEvents(h);
  const flaky = `${h.pages}/flaky?key=${Date.now()}`;
  h.loadSource({ uri: flaky });
  await waitFor(h, () => h.events.errors.length > 0 && idle(h.state()), 10000);
  const unavailable = h.events.errors[0];
  r.check(
    '503 reported',
    unavailable?.kind === 'http' && unavailable.statusCode === 503,
    unavailable
  );
  h.events.outcomes.length = 0;
  h.ref.current?.reload();
  const reloaded = await happens(waitFor(h, () => h.events.outcomes.includes('finished'), 10000));
  r.check('reload after an error loads the page', reloaded && h.state().url === flaky, {
    outcomes: h.events.outcomes,
    state: h.state(),
  });
  r.check('the reload reports no new error', h.events.errors.length === 1, h.events.errors);

  clearEvents(h);
  const key = `retry${Date.now()}`;
  const dropping = `${h.pages}/drop?key=${key}`;
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  h.loadSource({ uri: dropping });
  await waitFor(h, (s) => h.events.errors.length > 0 && s.url === dropping && idle(s), 10000);
  const dropped = h.events.errors[0];
  r.check(
    'a dropped connection is a network error',
    dropped?.kind === 'network' && h.state().outcome === 'failed',
    { dropped, state: h.state() }
  );
  await fetch(`${h.pages}/drop/set?key=${key}&fail=0`);
  const retried = await outcomeOf(() => h.ref.current?.reload());
  await waitFor(h, idle, 5000);
  r.check(
    'reload() after a network error loads the failed url',
    retried === 'finished' && h.state().url === dropping && h.events.errors.length === 1,
    { retried, state: h.state(), errors: h.events.errors }
  );

  const showsAndRetries = async (name: string, failed: string) => {
    await waitFor(h, idle, 5000);
    await sleep(500);
    r.check(`${name}: url is the failed url`, h.state().url === failed, h.state());
    clearEvents(h);
    const retried = await outcomeOf(() => h.ref.current?.reload());
    await sleep(500);
    const again = h.events.errors[0];
    r.check(
      `${name}: reload() retries the failed url`,
      retried === 'failed' &&
        again?.kind === 'ssl' &&
        again.url === failed &&
        h.state().url === failed,
      { retried, errors: h.events.errors, state: h.state() }
    );
  };

  for (const [name, to, failed] of [
    ['ssl error from the page', `'${HTTPS}/link'`, `${HTTPS}/link`],
    ['ssl error after a redirect', `'/redirect?to=${HTTPS}/redirected'`, `${HTTPS}/redirected`],
  ]) {
    await openPage(h, fresh(h, '/'));
    clearEvents(h);
    await h.ref.current?.evaluate(`location.href = ${to}`);
    const got = await happens(waitFor(h, () => h.events.errors.length > 0, 10000));
    r.check(
      name,
      got && h.events.errors[0]?.kind === 'ssl' && h.events.errors[0]?.url === failed,
      h.events.errors[0]
    );
    await showsAndRetries(name, failed);
  }

  const first = fresh(h, `${HTTPS}/first`);
  clearEvents(h);
  h.loadSource({ uri: first });
  h.remount();
  await waitFor(h, () => h.events.errors.length > 0, 10000);
  await showsAndRetries('ssl error of the first load of a new WebView', first);
}
