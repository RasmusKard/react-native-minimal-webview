import { runInNewContext } from 'node:vm';

import vectors from './vectors/origin-rules.json';
import { CONNECTION, createBridge } from '../bridge/createBridge';
import { type OriginForms, originForms, parseOrigin } from '../bridge/origins';
import { MATCHES_ORIGIN } from '../bridge/pageClient.generated';

// The page-side matcher takes `location.origin`, which is always serialized: lowercase, no default port. The other
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

  type Matcher = (forms: OriginForms, origin: string) => boolean;
  const matchesOrigin = runInNewContext(MATCHES_ORIGIN) as Matcher;
  it.each(cases)('the injected scripts guard: %s', (_name, c) => {
    expect(matchesOrigin(originForms(c.rules), c.origin)).toBe(c.allowed);
  });
});

it.each([
  ['an allowed origin', ['https://example.com'], 'https://example.com', true],
  ['another origin', ['https://example.com'], 'https://evil.example', false],
  ['* rules', ['*'], 'https://evil.example', true],
])("createBridge's page client installs on %s", (_name, allowedOrigins, origin, installed) => {
  const w: Record<string, unknown> = {
    location: { origin },
    document: { readyState: 'complete' },
    addEventListener: () => {},
  };
  w.top = w;
  w.window = w;
  runInNewContext(createBridge({ allowedOrigins })[CONNECTION].script, w);
  expect(w.nativeBridge !== undefined).toBe(installed);
});
