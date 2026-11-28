import type { OriginForms } from './matchesOrigin';
import { MATCHES_ORIGIN } from './pageClient.generated';

export const parseOrigin = (text: string) => {
  const m =
    /^(https?):\/\/(\*\.(?!\[))?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(
      text.toLowerCase()
    );
  if (!m) return null;
  const [, scheme, wildcard, host, port] = m;
  // `location.origin` leaves out the scheme's default port.
  const isDefaultPort = port === undefined || +port === (scheme === 'https' ? 443 : 80);
  const portSuffix = isDefaultPort ? '' : `:${+port!}`;
  return { scheme, wildcard: !!wildcard, hostPort: `${host}${portSuffix}` };
};

export const originForms = (rules: string[]): OriginForms => {
  const forms: OriginForms = { any: rules.includes('*'), exact: [], wild: [] };
  for (const rule of rules) {
    const r = parseOrigin(rule);
    if (!r) continue;
    if (r.wildcard) forms.wild.push([`${r.scheme}://`, `.${r.hostPort}`]);
    else forms.exact.push(`${r.scheme}://${r.hostPort}`);
  }
  return forms;
};

export function originGuard(errorPrefix: string, origins: string[]): string | null {
  const invalid = origins.filter((rule) => rule !== '*' && !parseOrigin(rule));
  if (invalid.length) {
    throw new Error(
      `${errorPrefix} ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
    );
  }
  const forms = originForms(origins);
  return forms.any ? null : `(${MATCHES_ORIGIN})(${JSON.stringify(forms)}, location.origin)`;
}
