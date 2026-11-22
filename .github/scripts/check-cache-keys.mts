// Fails when a workflow job that a cache hit skips reads a tracked file its cache key does not hash.
import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { matchesGlob, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

type Platform = 'apple' | 'android';
type ModuleConfig = Partial<Record<Platform, { podspecPath?: string; path?: string }>>;

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(posix.join(root, path), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((line) => {
    const [meta, path] = line.split('\t');
    return { symlink: meta.startsWith('120000'), path };
  });
const NOT_BUILT = /\.(tsx?|md)$/;

function filesUnder(dir: string, excluded = ''): string[] {
  const prefix = dir === '.' ? '' : `${dir}/`;
  return tracked.flatMap(({ symlink, path }) => {
    if (!path.startsWith(prefix) || (excluded && matchesGlob(path, excluded))) return [];
    if (symlink)
      return filesUnder(posix.join(posix.dirname(path), readlinkSync(posix.join(root, path))));
    return NOT_BUILT.test(path) ? [] : [path];
  });
}

function nativeModuleFiles(platform: Platform) {
  return tracked
    .filter(({ path }) => posix.basename(path) === 'expo-module.config.json')
    .flatMap(({ path: config }) => {
      const dir = posix.dirname(config);
      const own = (JSON.parse(read(config)) as ModuleConfig)[platform];
      const sources =
        platform === 'apple'
          ? posix.dirname(own?.podspecPath ?? 'ios/.')
          : (own?.path ?? 'android');
      const sourceDir = posix.join(dir, sources);
      const podspec = tracked.find(
        ({ path }) => posix.dirname(path) === sourceDir && path.endsWith('.podspec')
      );
      const excluded = podspec && read(podspec.path).match(/\.exclude_files\s*=\s*"([^"]+)"/)?.[1];
      return [
        config,
        posix.join(dir, 'package.json'),
        ...filesUnder(sourceDir, excluded && posix.join(sourceDir, excluded)),
      ];
    });
}

function appFiles(appDir: string, platform: Platform) {
  const other = platform === 'apple' ? 'android' : 'ios';
  const paths = (value: unknown): string[] => {
    if (typeof value === 'string') return value.startsWith('./') ? [value] : [];
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, inner]) => (key === other ? [] : paths(inner)));
  };
  const app = JSON.parse(read(posix.join(appDir, 'app.json'))) as { expo: unknown };
  return ['app.json', ...paths(app.expo)].map((path) => posix.join(appDir, path));
}

function reads(workflow: string) {
  const platform: Platform = /expo run:ios|--platform ios/.test(workflow) ? 'apple' : 'android';
  const appDir = workflow.match(/cd (\S+) && [^)]*npx expo (?:run|prebuild)/)?.[1];
  if (!appDir) throw new Error('no `cd <dir> && ... npx expo run|prebuild` in the workflow');
  return [
    ...[...workflow.matchAll(/\b[\w-]+-file: ([^\s,}]+)/g)].map(([, path]) => path),
    ...[...workflow.matchAll(/(?:cd (\S+) && )?npm ci\b/g)].flatMap(([, dir = '.']) =>
      ['package.json', 'package-lock.json'].map((file) => posix.join(dir, file))
    ),
    ...appFiles(appDir, platform),
    ...nativeModuleFiles(platform),
  ];
}

const gaps = tracked
  .map(({ path }) => path)
  .filter((path) => /^\.github\/workflows\/.*\.yml$/.test(path))
  .flatMap((path) => {
    const workflow = read(path);
    if (!workflow.includes('outputs.cache-hit')) return [];
    const key = workflow.match(/hashFiles\(([^)]*)\)/)?.[1];
    if (!key)
      throw new Error(`${path} skips steps on a cache hit, but its key has no hashFiles(...)`);
    const patterns = [...key.matchAll(/'([^']+)'/g)].map(([, pattern]) => pattern);
    const missed = [...new Set(reads(workflow))].filter(
      (file) => !patterns.some((pattern) => matchesGlob(file, pattern))
    );
    return missed.length ? [`${path}: the key does not hash ${missed.sort().join(', ')}`] : [];
  });
if (gaps.length) throw new Error(gaps.join('\n'));
