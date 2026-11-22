// Type-checks the ts and tsx samples in README.md, extensions/README.md and guides/*.md against src/ and the extensions
// package, and reports each error at its line in the Markdown. Each sample is a module of its own in build/doc-samples/.
// A relative import is the page's sample that exports what it imports.
// Then checks that the reference leads to each example: a section of guides/examples.md with a sample is the target of
// an `@see` in a doc comment of src/ or extensions/, and each such `@see` names a section that exists.
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
    const line = text.slice(0, match.index).split('\n').length + 1;
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

const examples = readFileSync(join(root, 'guides/examples.md'), 'utf8');
// the id GitHub and the docs site give a heading
const anchor = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
const sections = [...examples.matchAll(/^#{2,3} (.+)\n((?:(?!#{1,3} ).*\n)*)/gm)].map(
  ([, title, body]) => ({ anchor: anchor(title), sample: /^```/m.test(body) })
);
const comments = ['src', 'extensions']
  .flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !/(^|\/)(node_modules|build)\//.test(name))
      .map((name) => readFileSync(join(root, dir, name), 'utf8'))
  )
  .join('\n');
const linked = new Set(
  [...comments.matchAll(/@see \[[^\]]*\]\([^)]*\/guides\/examples\/#([\w-]+)\)/g)].map(
    (match) => match[1]
  )
);
const unlinked = [
  ...sections
    .filter((section) => section.sample && !linked.has(section.anchor))
    .map((section) => `guides/examples.md#${section.anchor}: no doc comment links it with @see`),
  ...[...linked]
    .filter((id) => !sections.some((section) => section.anchor === id))
    .map((id) => `@see guides/examples/#${id}: guides/examples.md has no such section`),
];
for (const problem of unlinked) console.error(problem);
if (unlinked.length) process.exit(1);
console.log(
  `${sections.filter((section) => section.sample).length} examples are linked from the reference`
);
