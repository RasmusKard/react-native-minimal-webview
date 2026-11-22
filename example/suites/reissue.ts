import { Platform } from 'react-native';

import {
  click,
  fresh,
  idle,
  nextDecision,
  openPage,
  sleep,
  waitFor,
  waitForLoad,
  happens,
  poll,
  until,
  quietFor,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';
import { OTHER } from '../pages';

export async function reissue(h: Harness, r: Reporter) {
  const asked: string[] = [];
  let answer: 'allow' | 'block' | 'late' = 'allow';
  const ask = async (url: string): Promise<'allow' | 'block'> => {
    asked.push(url);
    if (answer === 'late') await sleep(1500);
    return answer === 'block' ? 'block' : 'allow';
  };
  let answered: Promise<unknown> = Promise.resolve();
  h.setAsk((request) => (answered = ask(request.url)));
  h.setRules([
    { host: ['localhost', '127.0.0.1'], path: ['/checkout', '/headers'], action: 'ask' },
    { scheme: ['http', 'https'], action: 'allow' },
  ]);
  await sleep(300);
  const start = fresh(h, '/nav.html');
  await openPage(h, start);
  const startDepth = await h.ref.current?.evaluate('history.length');

  await click(h, 'checkout');
  r.check(
    'allow reissues the navigation',
    await happens(waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 5000)),
    h.state()
  );
  r.check('asked once', asked.length === 1, asked);
  r.info('request', asked[0]);
  const depth = await h.ref.current?.evaluate('history.length');
  r.check('one history entry added', depth === (startDepth as number) + 1, { startDepth, depth });
  h.ref.current?.goBack();
  r.check(
    'goBack returns to the start page',
    await happens(waitFor(h, (s) => s.url === start && idle(s), 5000)),
    h.state()
  );

  const checkout = () => nextDecision(h, () => click(h, 'checkout'), '/checkout/pay');
  answer = 'block';
  const blocked = await checkout();
  r.check(
    'block stays on the page',
    blocked?.action === 'block' && h.state().url === start && asked.length === 2,
    { decision: blocked, url: h.state().url, asked }
  );

  answer = 'late';
  const timedOut = await checkout();
  await answered;
  await quietFor(1000);
  r.check(
    'a late answer is ignored (timeout blocks)',
    timedOut?.action === 'block' && h.state().url === start && asked.length === 3,
    { decision: timedOut, url: h.state().url, asked }
  );

  answer = 'allow';
  await h.ref.current?.evaluate(`location.href = '/redirect?to=/checkout/pay%3Ffrom%3Dredirect'`);
  const redirected = await happens(
    waitFor(h, (s) => s.url.includes('from=redirect') && idle(s), 5000)
  );
  r.check('a redirect into an ask rule is asked and reissued', redirected && asked.length === 4, {
    url: h.state().url,
    asked,
  });

  const beforeFrame = asked.length;
  await h.ref.current?.evaluate(
    `(() => { const f = document.createElement('iframe'); f.src = '/checkout/frame'; document.body.append(f); f.onload = () => f.contentWindow.location.href = '/checkout/frame2'; })()`
  );
  await poll(() => asked.length > beforeFrame, 1500);
  if (Platform.OS === 'android') {
    r.check(
      'http(s) iframe navigations are not decided on Android',
      asked.length === beforeFrame,
      asked
    );
  } else {
    r.check('iframe navigations into an ask rule are asked', asked.length > beforeFrame, asked);
  }

  const referrerTo = async (target: string) => {
    const from = fresh(h, '/nav.html');
    await openPage(h, from);
    await h.ref.current?.evaluate(`location.href = '${target}'`);
    await waitFor(h, (s) => s.url === target && idle(s), 5000);
    const headers = (await h.ref.current?.evaluate(
      `JSON.parse(document.getElementById('headers').textContent)`
    )) as { referer?: string } | undefined;
    return { from, referer: headers?.referer };
  };
  const same = await referrerTo(`${h.pages}/headers?r=same`);
  r.check('an allowed navigation keeps the referrer', same.referer === same.from, same);
  const cross = await referrerTo(`${OTHER}/headers?r=cross`);
  r.check('cross-origin, the referrer is the origin', cross.referer === `${h.pages}/`, cross);

  const beforeUnmount = fresh(h, '/nav.html');
  await openPage(h, beforeUnmount);
  answer = 'late';
  const pending = asked.length;
  await click(h, 'checkout');
  await until(() => asked.length > pending, 900);
  const remounted = await happens(
    waitForLoad(
      h,
      () => h.remount(),
      (s) => s.url === beforeUnmount && idle(s),
      10000
    )
  );
  await answered;
  await quietFor(1000);
  r.check(
    'an unmount while a navigation ask waits: the remounted WebView loads its source and stays',
    asked.length === pending + 1 && remounted && h.state().url === beforeUnmount,
    { asked: asked.slice(pending), remounted, state: h.state() }
  );
  answer = 'allow';
  await click(h, 'checkout');
  r.check(
    'after that unmount, an ask is answered and its page loads',
    (await happens(waitFor(h, (s) => s.url.endsWith('/checkout/pay') && idle(s), 5000))) &&
      asked.length === pending + 2,
    { asked: asked.slice(pending), state: h.state() }
  );
}
