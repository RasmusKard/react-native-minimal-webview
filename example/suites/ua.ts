import {
  USER_AGENT_KEY,
  clearEvents,
  errorCode,
  fresh,
  happens,
  idle,
  openPage,
  quietFor,
  tapLink,
  text,
  until,
  waitFor,
  waitForLoad,
} from '../harness/helpers';
import { type Harness, type Reporter } from '../harness/runner';

export async function ua(h: Harness, r: Reporter) {
  const read = async () => {
    await openPage(h, fresh(h, '/ua'));
    return {
      header: await text(h, 'ua'),
      navigator: (await h.ref.current?.evaluate('navigator.userAgent')) as string,
    };
  };
  const suffixed = await read();
  r.check(
    'the app name is appended (header)',
    suffixed.header.endsWith(' MinimalWebViewExample/1.0'),
    suffixed
  );
  r.check(
    'navigator.userAgent matches the header',
    suffixed.navigator === suffixed.header,
    suffixed
  );
  const native = () => h.ref.current?.get(USER_AGENT_KEY).catch(errorCode);
  h.setProps({ userAgent: 'CustomAgent/2.0' });
  await until(async () => (await native()) === 'CustomAgent/2.0', 3000);
  const custom = await read();
  r.check(
    'userAgent replaces the whole UA',
    custom.header === 'CustomAgent/2.0' && custom.navigator === 'CustomAgent/2.0',
    custom
  );
  h.setProps({});
  await until(async () => (await native()) !== 'CustomAgent/2.0', 3000);
  const back = await read();
  r.check(
    'removing userAgent restores the default',
    back.header.endsWith(' MinimalWebViewExample/1.0'),
    back
  );

  await r.block('with userAgent set from the mount', async () => {
    const first = fresh(h, '/ptr.html?mode=short&page=first');
    await waitForLoad(
      h,
      () => {
        h.setProps({ userAgent: 'CustomAgent/2.0' });
        h.loadSource({ uri: first });
        h.remount();
      },
      (s) => s.url === first && idle(s)
    );
    const second = fresh(h, '/ptr.html?mode=short&page=second');
    await tapLink(h, r, second);
    r.check(
      'a tapped link adds a history entry',
      await happens(waitFor(h, (s) => s.url === second && idle(s) && s.canGoBack)),
      h.state()
    );
    h.ref.current?.goBack();
    r.check(
      'goBack returns to the first page, the only entry before it',
      await happens(waitFor(h, (s) => s.url === first && idle(s) && !s.canGoBack)),
      h.state()
    );
    const reloadsOnce = async (act: () => unknown) => {
      const before = await text(h, 'loaded');
      clearEvents(h);
      const ended = await happens(waitForLoad(h, act));
      await quietFor(1000);
      return {
        ended,
        loads: h.events.loads,
        reloaded: (await text(h, 'loaded')) !== before,
        userAgent: await h.ref.current?.evaluate('navigator.userAgent'),
      };
    };
    const once = (result: Awaited<ReturnType<typeof reloadsOnce>>) =>
      result.ended &&
      result.reloaded &&
      result.loads.join() === 'start,end' &&
      result.userAgent === 'CustomAgent/2.0';
    const reload = await reloadsOnce(() => h.ref.current?.reload());
    r.check('reload() reloads once and its load ends', once(reload), reload);
    const pull = await reloadsOnce(() => r.drive({ action: 'swipe', kind: 'full' }));
    r.check('pull to refresh reloads once and its load ends', once(pull), pull);
  });
}
