import { MATCHES_ORIGIN } from './pageClient.generated';

/**
 * An origin rule (`http(s)://host[:port]`, `http(s)://*.host[:port]`) or a `location.origin`, parsed; null for anything
 * else, `*` included.
 */
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

export type OriginForms = { any: boolean; exact: string[]; wild: [string, string][] };

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

function hasAt(text: string, part: string, at: number) {
  for (let k = 0; k < part.length; k++) if (text[at + k] !== part[k]) return false;
  return true;
}

/**
 * Whether `origin`, as `location.origin` serializes it, matches `forms`. Only `===`, indexing and `length`, no
 * built-in method: it runs at document start in frames whose built-ins another same-origin frame may have patched.
 */
export function matchesOrigin(forms: OriginForms, origin: string) {
  if (forms.any) return true;
  for (let i = 0; i < forms.exact.length; i++) if (forms.exact[i] === origin) return true;
  for (let i = 0; i < forms.wild.length; i++) {
    const prefix = forms.wild[i]![0];
    const suffix = forms.wild[i]![1];
    const start = origin.length - suffix.length;
    if (start > prefix.length && hasAt(origin, prefix, 0) && hasAt(origin, suffix, start))
      return true;
  }
  return false;
}

/**
 * A page-side expression true where `location.origin` matches `origins`, or null when they include `*`. Throws an
 * `Error` starting with `what` for a rule that is neither `*` nor what `parseOrigin` takes.
 */
export function originGuard(what: string, origins: string[]): string | null {
  const invalid = origins.filter((rule) => rule !== '*' && !parseOrigin(rule));
  if (invalid.length) {
    throw new Error(
      `${what} ${JSON.stringify(invalid)} (use https://example.com or https://*.example.com, no path)`
    );
  }
  const forms = originForms(origins);
  return forms.any ? null : `(${MATCHES_ORIGIN})(${JSON.stringify(forms)}, location.origin)`;
}
