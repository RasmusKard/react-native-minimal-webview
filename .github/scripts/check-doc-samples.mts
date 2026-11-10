// Type-checks the ts and tsx samples in README.md, extensions/README.md and guides/*.md against src/ and the extensions
// package, and reports each error at its line in the Markdown. Each sample is a module of its own in build/doc-samples/.
// A relative import is the page's sample that exports what it imports. doc-samples.d.ts declares the modules the
// samples import that aren't installed here.
// Run: node .github/scripts/check-doc-samples.mts (npm run check runs it).
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'build/doc-samples');
const guides = readdirSync(join(root, 'guides')).filter((name) => name.endsWith('.md'));
const pages = ['README.md', 'extensions/README.md', ...guides.map((name) => `guides/${name}`)];

const samples = pages.flatMap((page) => {
  const text = readFileSync(join(root, page), 'utf8');
  return [...text.matchAll(/^```(tsx?)\n([\s\S]*?)^```$/gm)].map((match) => {
    const line = text.slice(0, match.index).split('\n').length + 1; // the sample's first line
    return {
      page,
      line,
      code: match[2],
      file: join(out, `${page.slice(0, -'.md'.length)}-${line}.${match[1]}`),
    };
  });
});
const exportsAll = (code: string, names: string) =>
  names
    .split(',')
    .every((name) => new RegExp(`^export (const|function) ${name.trim()}\\b`, 'm').test(code));
for (const sample of samples) {
  for (const [, names, from] of sample.code.matchAll(/^import \{([^}]+)\} from '(\.[^']+)';$/gm)) {
    const target = samples.find((s) => s.page === sample.page && exportsAll(s.code, names));
    if (target) target.file = join(dirname(sample.file), from + extname(target.file));
  }
}
rmSync(out, { recursive: true, force: true });
for (const { file, code } of samples) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
}

const { options } = ts.parseJsonConfigFileContent(
  {
    extends: join(root, 'tsconfig.json'),
    compilerOptions: {
      noEmit: true,
      rootDir: root,
      types: [],
      noUnusedLocals: false, // a sample names what it shows
      paths: {
        'react-native-minimal-webview': [join(root, 'src/index.ts')],
        '@react-native-minimal-webview/extensions': [join(root, 'extensions/src/index.ts')],
      },
    },
  },
  ts.sys,
  out
);
const stubs = fileURLToPath(new URL('doc-samples.d.ts', import.meta.url));
const program = ts.createProgram([...samples.map((s) => s.file), stubs], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
for (const d of diagnostics) {
  const sample = samples.find((s) => s.file === d.file?.fileName);
  let where = d.file?.fileName ?? 'tsc';
  if (sample && d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    where = `${sample.page}:${sample.line + line}:${character + 1}`;
  }
  console.error(`${where}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}
if (diagnostics.length) process.exit(1);
console.log(`${samples.length} samples type-check`);
