import { Platform } from 'react-native';

import { clearEvents, fresh, idle, openPage, sleep, until, waitFor } from '../harness/helpers';
import { WEBVIEW, type Harness, type Reporter } from '../harness/runner';
import { HTTPS } from '../pages';

/**
 * Main-frame errors only, the URL after a failure, how each kind of load ends (`outcome`), the example's error screen
 * (the recipe in guides/examples.md#loading-and-error-screens), and reload recovering.
 */
export async function errors(h: Harness, r: Reporter) {
  await openPage(h, fresh(h, '/'));
  /** Runs `act`, then waits for the next load to end: its outcome, or 'no end' after `ms`. */
  const outcomeOf = async (act: () => unknown, ms = 10000) => {
    const n = h.events.outcomes.length;
    await act();
    await until(() => h.events.outcomes.length > n, ms, 50);
    return h.events.outcomes.length > n ? h.events.outcomes[n] : 'no end';
  };

  clearEvents(h);
  const unreachable = 'http://localhost:8099/nothing'; // nothing listens there
  h.load(unreachable);
  const gotNetwork = await waitFor(h, () => h.events.errors.length > 0, 10000);
  await waitFor(h, idle, 5000);
  await sleep(500);
  const network = h.events.errors[0];
  r.check('network error', gotNetwork && network?.kind === 'network', network);
  r.check('url is the failed url', h.state().url === unreachable, h.state());
  r.check(
    'a failed load ends once, as failed',
    JSON.stringify(h.events.outcomes) === '["failed"]',
    { loads: h.events.loads, outcomes: h.events.outcomes }
  );
  r.check(
    'the error screen is shown after a failure',
    await waitFor(h, () => h.events.overlay.error, 3000)
  );

  clearEvents(h);
  const notFound = await outcomeOf(() => h.load(fresh(h, '/status/404')));
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
    await waitFor(h, () => !h.events.overlay.error, 3000)
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
    h.load(fresh(h, '/slow?ms=3000'));
    await waitFor(h, (s) => s.loading, 3000);
    h.ref.current?.stopLoading();
  }, 5000);
  r.since(
    WEBVIEW.navigationListener,
    'a stopped load ends as cancelled',
    stopped === 'cancelled',
    stopped
  );
  // A load replaced before it commits: iOS keeps loading into the newer one.
  clearEvents(h);
  h.load(fresh(h, '/slow?ms=3000'));
  await waitFor(h, (s) => s.loading, 3000);
  const newer = fresh(h, '/');
  h.load(newer);
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
  const noContent = await outcomeOf(() => h.load(fresh(h, '/status/204')), 5000);
  // WebKit 298028@main stops a 204 for a policy change instead of finishing it; first in Safari 26.2 (20623.1.14).
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
  h.load(flaky);
  await waitFor(h, () => h.events.errors.length > 0 && idle(h.state()), 10000);
  const unavailable = h.events.errors[0];
  r.check(
    '503 reported',
    unavailable?.kind === 'http' && unavailable.statusCode === 503,
    unavailable
  );
  h.events.outcomes.length = 0;
  h.ref.current?.reload();
  const reloaded = await waitFor(h, () => h.events.outcomes.includes('finished'), 10000);
  r.check('reload after an error loads the page', reloaded && h.state().url === flaky, {
    outcomes: h.events.outcomes,
    state: h.state(),
  });
  r.check('the reload reports no new error', h.events.errors.length === 1, h.events.errors);

  // An app's retry button: reload() after a network failure fetches the failed URL again.
  clearEvents(h);
  const key = `retry${Date.now()}`;
  const dropping = `${h.pages}/drop?key=${key}`;
  await fetch(`${h.pages}/drop/set?key=${key}&fail=1`);
  h.load(dropping);
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

  // Page-initiated, then through a redirect: on Android these reach the SSL check through shouldOverrideUrlLoading.
  for (const [name, to, failed] of [
    ['ssl error from the page', `'${HTTPS}/link'`, `${HTTPS}/link`],
    ['ssl error after a redirect', `'/redirect?to=${HTTPS}/redirected'`, `${HTTPS}/redirected`],
  ]) {
    await openPage(h, fresh(h, '/'));
    clearEvents(h);
    await h.ref.current?.evaluate(`location.href = ${to}`);
    const got = await waitFor(h, () => h.events.errors.length > 0, 10000);
    r.check(
      name,
      got && h.events.errors[0]?.kind === 'ssl' && h.events.errors[0]?.url === failed,
      h.events.errors[0]
    );
  }
}
