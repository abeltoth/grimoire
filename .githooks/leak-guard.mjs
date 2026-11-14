// Git's pre-commit and pre-push hooks run this, since CI sees a leak only once it is public: it
// refuses a commit or push that carries a secret or, in the public repo, the private repo's code.
// `node .githooks/leak-guard.mjs staged|push [--secrets-only]`; the private repo checks secrets only.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Secrets by their well-known shapes. */
export const SECRETS = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an Anthropic key', /\bsk-ant-[\w-]{20,}/],
  ['an OpenAI key', /\bsk-(?!ant-)(?:proj-)?[\w-]{32,}/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,})/],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Google key', /\bAIza[\w-]{35}\b/],
  ['a Slack token', /\bxox[abprs]-[\w-]{10,}/],
];

/** Files that hold secrets by their names. */
const SECRET_FILES = /(^|\/)(\.env(\.[\w.-]+)?|id_(rsa|ed25519|ecdsa)|[^/]+\.(pem|key|p12|pfx))$/;

/** Files this small are too common to tell a copy by. */
const MIN_COPY_LENGTH = 200;

/** A file's text, hashed the same whatever its line endings. */
export const hashOf = (text) =>
  createHash('sha1').update(text.replaceAll('\r\n', '\n')).digest('hex');

/** Each file a unified diff adds or changes, with the lines it adds. */
export function parseDiff(diff) {
  const changes = [];
  for (const line of diff.split(/\r?\n/)) {
    const binary = /^Binary files .+ and (.+) differ$/.exec(line);
    if (line.startsWith('+++ ') || binary) {
      const file = (binary ? binary[1] : line.slice(4)).replace(/^b\//, '');
      changes.push({ file: file === '/dev/null' ? null : file, added: [] });
    } else if (line.startsWith('+') && changes.length) {
      changes.at(-1).added.push(line.slice(1));
    }
  }
  return changes.filter((change) => change.file);
}

/** What marks the private repo's code: its modules' names, its folders and its files' text. */
export function proMarks(privateRoot) {
  const entries = (top) =>
    existsSync(path.join(privateRoot, top))
      ? readdirSync(path.join(privateRoot, top), { withFileTypes: true })
      : [];
  const modules = entries('modules')
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const folders = ['modules', 'design'].flatMap((top) =>
    entries(top)
      .filter((entry) => top === 'design' || modules.includes(entry.name))
      .map((entry) => `${top}/${entry.name}`),
  );
  const files = folders.flatMap((folder) => {
    const full = path.join(privateRoot, folder);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  });
  const texts = files.map((file) => readFileSync(file, 'utf8'));
  const hashes = new Set(texts.filter((t) => t.length >= MIN_COPY_LENGTH).map(hashOf));
  return { modules, folders, hashes };
}

/** What the changes would leak, each as `file: what`; `marks` is null when only secrets count. */
export function leaksIn(changes, marks, textOf) {
  const found = [];
  for (const { file, added } of changes) {
    if (SECRET_FILES.test(file)) found.push(`${file}: a file for secrets`);
    for (const [name, shape] of SECRETS) {
      if (added.some((line) => shape.test(line))) found.push(`${file}: ${name}`);
    }
    if (!marks) continue;
    const folder = marks.folders.find((f) => file === f || file.startsWith(`${f}/`));
    if (folder) found.push(`${file}: ${folder} belongs to the private repo`);
    for (const name of marks.modules) {
      if (added.some((line) => line.includes(`--gr-${name}-`)))
        found.push(`${file}: the pro module ${name}'s tokens`);
    }
    const text = textOf(file);
    if (text && text.length >= MIN_COPY_LENGTH && marks.hashes.has(hashOf(text)))
      found.push(`${file}: a copy of a file in the private repo`);
  }
  return [...new Set(found)];
}

const git = (root, ...args) =>
  spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
const DIFF = ['--no-color', '--no-ext-diff', '--no-renames', '-U0'];
const ZERO = /^0+$/;

/** The diffs to check, each with how to read a file as it would leave: staged, or pushed. */
function outgoing(root, mode, stdin) {
  if (mode === 'staged') {
    const diff = git(root, 'diff', '--cached', ...DIFF).stdout;
    return [{ diff, textOf: (file) => git(root, 'show', `:${file}`).stdout }];
  }
  return stdin
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, local]) => local && !ZERO.test(local))
    .map(([, local, , remote]) => {
      const known =
        remote && !ZERO.test(remote) && git(root, 'cat-file', '-e', remote).status === 0;
      const range = known ? [`${remote}..${local}`] : [local, '--not', '--remotes'];
      const diff = git(root, 'log', '-p', '--format=', ...DIFF, ...range).stdout;
      return { diff, textOf: (file) => git(root, 'show', `${local}:${file}`).stdout };
    });
}

/** The private repo beside this one, or around it when this is its core/ checkout. */
function privateRepoFor(root) {
  return [path.resolve(root, '..', 'grimoire-pro'), path.resolve(root, '..')].find((dir) =>
    ['modules', 'extra-modules', 'core'].every((part) => existsSync(path.join(dir, part))),
  );
}

async function main() {
  const [mode, flag] = process.argv.slice(2);
  if (mode !== 'staged' && mode !== 'push') throw new Error(`unknown mode ${mode}`);
  let stdin = '';
  if (mode === 'push') for await (const chunk of process.stdin) stdin += chunk;
  const root = path.resolve(git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim());
  const privateRoot = flag === '--secrets-only' ? null : privateRepoFor(root);
  const marks =
    flag === '--secrets-only'
      ? null
      : privateRoot
        ? proMarks(privateRoot)
        : { modules: [], folders: [], hashes: new Set() };
  const found = outgoing(root, mode, stdin).flatMap(({ diff, textOf }) =>
    leaksIn(parseDiff(diff), marks, textOf),
  );
  if (!found.length) return 0;
  process.stderr.write(
    `Refused: this ${mode === 'push' ? 'push' : 'commit'} carries what must not leave here.\n` +
      [...new Set(found)].map((line) => `  ${line}\n`).join('') +
      (mode === 'push'
        ? 'Take it out of the commits themselves, since history keeps it, then push again.\n'
        : 'Unstage it, then commit again.\n'),
  );
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main().catch((error) => {
    process.stderr.write(`The leak guard couldn't run, so git stopped: ${error}\n`);
    return 1;
  });
}
