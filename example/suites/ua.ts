import { USER_AGENT_KEY, errorCode, fresh, openPage, text, until } from '../harness/helpers';
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
}
