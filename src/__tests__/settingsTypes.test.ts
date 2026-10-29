// Type-level checks, run by `npx tsc --noEmit -p src/__tests__/tsconfig.json`: each expected error below must occur.
import { IOSConstants } from '../platform.generated';
import type { AndroidSettings, IOSSettings } from '../types';

const ios: IOSSettings = {
  configuration: {
    dataDetectorTypes: IOSConstants.DataDetectorTypes.link,
    allowUniversalAccessFromFileURLs: true,
    other: { someNewerProperty: true },
  },
  preferences: { allowFileAccessFromFileURLs: true },
  scrollView: { bounces: false, other: { nope: 1 } },
};
const android: AndroidSettings = {
  settings: { cacheMode: 2, other: { aNewerSetter: 'x' } },
  webView: { overScrollMode: 2 },
};

// @ts-expect-error because the key is misspelled
const typo: IOSSettings = { scrollView: { bouncess: false } };
// @ts-expect-error because the key is misspelled
const androidTypo: AndroidSettings = { settings: { textZooom: 120 } };
// @ts-expect-error because a generated key can't go under other
const known: IOSSettings = { webView: { other: { inspectable: true } } };
const misspelled = { bouncess: false };
// @ts-expect-error because the object shares no key with the root
const fromVariable: IOSSettings = { scrollView: misspelled };
// @ts-expect-error because the value has the wrong type
const wrongType: AndroidSettings = { settings: { textZoom: 'big' } };

it('types the known settings keys and takes the others under other', () => {
  expect([ios, android, typo, androidTypo, known, fromVariable, wrongType]).toHaveLength(7);
});
