// The origin rules in RN: parser, validator, and the matcher whose text build-page-client.mts cuts out as MATCHES_ORIGIN
// for the guards that createBridge and injectedScripts put around page code.

/**
 * An origin rule (`http(s)://host[:port]`, `http(s)://*.host[:port]`) or a `location.origin`, parsed; null for anything
 * else, `*` included. OriginRules.swift matches the same way: both run src/__tests__/vectors/origin-rules.json.
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

/** The rules that are neither `*` nor what `parseOrigin` takes. */
export const invalidOrigins = (rules: string[]) =>
  rules.filter((rule) => rule !== '*' && !parseOrigin(rule));

/** Origin rules in `location.origin` form, for `matchesOrigin`: exact origins, and wildcards as prefix and suffix. */
export type OriginForms = { any: boolean; exact: string[]; wild: [string, string][] };

/** `rules` in the form `matchesOrigin` compares; a rule `parseOrigin` rejects is left out, so it matches nothing. */
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

/** Whether `text` holds `part` at index `at`, compared character by character. */
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
    // At least one character of subdomain between the two.
    if (start > prefix.length && hasAt(origin, prefix, 0) && hasAt(origin, suffix, start))
      return true;
  }
  return false;
}
