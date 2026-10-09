import vectors from '../../test-vectors/navigation-rules.json';
import { decideNavigation } from '../navigationRules';
import type { NavigationRule } from '../types';

type Case = {
  name: string;
  rules: string | null;
  request: { url: string; mainFrame?: boolean; newWindow?: boolean; userInitiated?: boolean };
  expect: { action: string; rule: number | null };
};

const rulesets = vectors.rulesets as Record<string, NavigationRule[]>;

describe('decideNavigation (shared cases)', () => {
  it.each((vectors.cases as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const decision = decideNavigation(c.rules === null ? undefined : rulesets[c.rules], {
      url: c.request.url,
      mainFrame: c.request.mainFrame ?? true,
      newWindow: c.request.newWindow ?? false,
      userInitiated: c.request.userInitiated ?? false,
    });
    expect(decision).toEqual(c.expect);
  });
});
