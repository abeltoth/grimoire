// A PreToolUse hook on Bash: runs `npm run check` before Claude commits, and exits 2 to refuse the
// commit when it fails, so a broken check never reaches the history. The check is the one of the
// repository the commit lands in, which needn't be the session's own.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = /(^|[\s;&|(])git((?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*)\s+commit\b/;
const FOLDER = String.raw`("[^"]*"|'[^']*'|[^\s;&|)]+)`;

/** Whether a shell command runs `git commit`, with or without git's own options before it. */
export function isCommit(command) {
  return COMMIT.test(command);
}

/** A folder as typed, unquoted, with a Git Bash drive such as `/c/Users` read as Windows does. */
function native(typed) {
  const folder = typed.replace(/^(["'])(.*)\1$/, '$2');
  const drive = /^\/([a-z])(\/|$)/i.exec(folder);
  return process.platform === 'win32' && drive
    ? `${drive[1].toUpperCase()}:/${folder.slice(3)}`
    : folder;
}

/** The folder a command is in at `index`: `cwd`, moved by each `cd` before it. */
export function folderAt(command, index, cwd) {
  const cds = command
    .slice(0, index)
    .matchAll(new RegExp(String.raw`(?:^|[\s;&|(])cd\s+${FOLDER}`, 'g'));
  return [...cds].reduce((folder, cd) => path.resolve(folder, native(cd[1])), cwd);
}

/** The folder a command commits in, after its `cd`s and the commit's `git -C`; null for none. */
export function commitFolder(command, cwd) {
  const commit = COMMIT.exec(command);
  if (!commit) return null;
  const options = commit[2].matchAll(new RegExp(String.raw`-C\s+${FOLDER}`, 'g'));
  return [...options].reduce(
    (folder, option) => path.resolve(folder, native(option[1])),
    folderAt(command, commit.index, cwd),
  );
}

/** The top folder of the git repository a folder is in; null outside one. */
export function repositoryOf(folder) {
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: folder, encoding: 'utf8' });
  return git.status === 0 ? path.resolve(git.stdout.trim()) : null;
}

/** Runs a repository's `npm run check`: null when it passes or it has none, else why it failed. */
export function checkFails(repository) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8'));
    if (!pkg.scripts?.check) return null;
  } catch {
    return null;
  }
  const check = spawnSync('npm run check', {
    cwd: repository,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (check.status === 0) return null;
  const output = `${check.stdout ?? ''}${check.stderr ?? ''}${check.error?.message ?? ''}`;
  const tail = output.trim().split(/\r?\n/).slice(-80).join('\n');
  return `npm run check failed in ${repository}, so the commit was refused. Fix it, then commit.\n\n${tail}\n`;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { tool_input: tool = {}, cwd } = JSON.parse(input);
  const project = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const folder = commitFolder(tool.command ?? '', cwd ?? project);
  if (!folder) return 0;
  const failed = checkFails(repositoryOf(folder) ?? project);
  if (!failed) return 0;
  process.stderr.write(failed);
  return 2;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main().catch((error) => {
    process.stderr.write(`The commit check couldn't run: ${error}\n`);
    return 2;
  });
}
