import { runInNewContext } from 'node:vm';

import vectors from './vectors/origin-rules.json';
import { createBridge } from '../bridge/createBridge';
import { type OriginForms, originForms, parseOrigin } from '../bridge/endpoint';
import { installPageClient } from '../bridge/pageClient';
import { MATCHES_ORIGIN } from '../bridge/pageClient.generated';

// The page-side matchers take `location.origin`, which is always serialized: lowercase, no default port. The other
// origins in the vectors are for the native matchers.
const serialized = (origin: string) =>
  !parseOrigin(origin) || originForms([origin]).exact[0] === origin;
const cases = vectors.cases.filter((c) => serialized(c.origin)).map((c) => [c.name, c] as const);

describe('origin rules (shared cases)', () => {
  const rules = (valid: boolean) =>
    vectors.validation.filter((v) => v.valid === valid).map((v) => v.rule);
  it.each(rules(true))('createBridge accepts %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).not.toThrow();
  });
  it.each(rules(false))('createBridge rejects %j', (rule) => {
    expect(() => createBridge({ allowedOrigins: [rule] })).toThrow('invalid allowedOrigins');
  });

  it.each(cases)('page client: %s', (_name, c) => {
    const w = {
      location: { origin: c.origin },
      document: { readyState: 'complete' },
      addEventListener: () => {},
    } as unknown as Parameters<typeof installPageClient>[0];
    Object.assign(w, { top: w });
    installPageClient(w, 1000, c.rules);
    expect(w.nativeBridge !== undefined).toBe(c.allowed);
  });

  type Matcher = (forms: OriginForms, origin: string) => boolean;
  const matchesOrigin = runInNewContext(MATCHES_ORIGIN) as Matcher;
  it.each(cases)('the injected scripts guard: %s', (_name, c) => {
    expect(matchesOrigin(originForms(c.rules), c.origin)).toBe(c.allowed);
  });
});
