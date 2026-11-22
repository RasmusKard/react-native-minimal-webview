// Fails when the Topics of ios/MinimalWebView.docc/MinimalWebView.md and the pod's public Swift types differ. DocC's
// Markdown export has no automatic Topics before https://github.com/swiftlang/swift-docc/pull/1625, so a type the page
// doesn't list gets no page. A type marked @_documentation(visibility: internal) is left out of both.
// Run: node .github/scripts/check-docc-topics.mts (npm test runs it).
import { readdirSync, readFileSync } from 'node:fs';

const ios = new URL('../../ios/', import.meta.url);
const declaration =
  /^(@_documentation\(visibility: internal\)\n)?(?:public|open) (?:final )?(?:class|struct|enum|protocol|actor|typealias) (\w+)/gm;
const declared = readdirSync(ios, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.swift') && !file.startsWith('Tests/'))
  .flatMap((file) => [...readFileSync(new URL(file, ios), 'utf8').matchAll(declaration)])
  .filter(([, hidden]) => !hidden)
  .map(([, , name]) => name);
const page = 'ios/MinimalWebView.docc/MinimalWebView.md';
const listed = [
  ...readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8').matchAll(/^- ``(\w+)``$/gm),
].map(([, name]) => name);
const missing = declared.filter((name) => !listed.includes(name));
const gone = listed.filter((name) => !declared.includes(name));
if (missing.length || gone.length) {
  console.error(
    [
      missing.length && `${page} doesn't list the public Swift types ${missing.join(', ')}`,
      gone.length && `${page} lists ${gone.join(', ')}, which no public Swift type is`,
    ]
      .filter(Boolean)
      .join('\n')
  );
  process.exit(1);
}
