import type { NavigationAction, NavigationRequest, NavigationRule } from './types';

export type NavigationDecision = { action: NavigationAction | 'ask'; rule: number | null };

const INTERNAL_SCHEMES = new Set(['about', 'blob', 'data', 'javascript']);
// scheme ":" ["//" authority] path; query and fragment are ignored.
const URL_PARTS = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)/i;

const list = (value: string | string[] | undefined) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** Host without userinfo, port or a trailing dot, lowercased; null when there is none. */
function hostOf(authority: string | undefined): string | null {
  if (!authority) return null;
  const withoutUser = authority.slice(authority.lastIndexOf('@') + 1);
  const host = withoutUser.startsWith('[')
    ? withoutUser.slice(0, withoutUser.indexOf(']') + 1)
    : withoutUser.replace(/:\d*$/, '');
  return host.toLowerCase().replace(/\.$/, '') || null;
}

const hostMatches = (pattern: string, host: string) =>
  pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;

const FLAGS = ['mainFrame', 'newWindow', 'userInitiated'] as const;

/**
 * What native decides for a navigation: the same matcher as Kotlin and Swift, checked against the shared cases in
 * test-vectors/navigation-rules.json. Useful for unit-testing an app's rules.
 */
export function decideNavigation(
  rules: NavigationRule[] | undefined,
  request: NavigationRequest
): NavigationDecision {
  const parts = URL_PARTS.exec(request.url);
  const scheme = parts?.[1]?.toLowerCase() ?? '';
  if (INTERNAL_SCHEMES.has(scheme)) return { action: 'allow', rule: null };
  if (!rules?.length) {
    const action =
      scheme === 'http' || scheme === 'https' ? 'allow' : scheme === 'file' ? 'block' : 'external';
    return { action, rule: null };
  }
  const host = hostOf(parts?.[2]);
  const path = parts?.[2] !== undefined && parts[3] ? parts[3] : '/';
  const index = rules.findIndex((rule) => {
    const schemes = list(rule.scheme);
    const hosts = list(rule.host);
    const paths = list(rule.path);
    return (
      (!schemes || schemes.some((s) => s.toLowerCase() === scheme)) &&
      (!hosts || (host !== null && hosts.some((h) => hostMatches(h.toLowerCase(), host)))) &&
      (!paths || paths.some((p) => path.startsWith(p))) &&
      FLAGS.every((flag) => rule[flag] === undefined || rule[flag] === request[flag])
    );
  });
  return index < 0
    ? { action: 'block', rule: null }
    : { action: rules[index]!.action, rule: index };
}
