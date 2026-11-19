/** The tools whose calls are counted by a group, and how each finds it. */
const GROUPS = new Map<string, (input: Record<string, unknown>) => string | undefined>([
  ['Bash', (input) => commandGroup(input['command'])],
  ['PowerShell', (input) => commandGroup(input['command'])],
  ['Read', (input) => folderOf(input['file_path'])],
  ['WebFetch', (input) => siteOf(input['url'])],
]);

/**
 * What a call is counted under where usage is broken down: a command by
 * its program, and the subcommand for a program that has them; a file by
 * its folder; an address by its site. Undefined for other tools, or when
 * there's none to tell.
 */
export function groupOf(tool: string, input: unknown): string | undefined {
  const find = GROUPS.get(tool);
  return find && input && typeof input === 'object'
    ? find(input as Record<string, unknown>)
    : undefined;
}

/** Programs whose second word says what they do, such as `git diff` or `npm test`. */
const SUBCOMMANDS = new Set([
  'git',
  'gh',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'docker',
  'kubectl',
  'cargo',
  'go',
  'dotnet',
  'pip',
  'uv',
  'az',
  'aws',
  'gcloud',
  'wrangler',
]);

/** Package managers whose `run` says which script, as `npm run check`. */
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Flags of those programs that take the next word, such as `git -C <folder>`. */
const VALUED = new Set(['-C', '-c', '--prefix', '--git-dir', '--work-tree', '--cwd', '--dir']);

/** Words before a command that only set where or how it runs. */
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'env', 'exec', 'command']);

/** Commands that only move to a folder or set the shell up. */
const MOVES = new Set([
  'cd',
  'pushd',
  'popd',
  'set-location',
  'push-location',
  'sl',
  'export',
  'set',
  'source',
  '.',
]);

/**
 * Whether a command only moves to a folder, sets a variable or closes a
 * block, so what it runs is a later one.
 */
function setsUp([first, second]: string[]): boolean {
  if (!first || first === '}') return true;
  // PowerShell's `$x = ...`, and the shell's `X=value` alone or `X=$(...)`.
  const powerShell =
    /^\$[\w:]+=?$/.test(first) && (first.endsWith('=') || !!second?.startsWith('='));
  const shell = /^[A-Za-z_]\w*=/.test(first) && (second === undefined || /^\w+=\$\(/.test(first));
  return MOVES.has(first.toLowerCase()) || powerShell || shell;
}

/** A word that names a program, once its quotes and folders are gone. */
const PROGRAM = /^[\w.+-]+$/;

/** What a command line runs: its first program past moving folders and setting variables. */
export function commandGroup(command: unknown): string | undefined {
  if (typeof command !== 'string') return undefined;
  for (const segment of segmentsOf(command)) {
    if (setsUp(segment)) continue;
    return programOf(segment);
  }
  return undefined;
}

/** Where one command ends and the next begins. */
const SEPARATORS = new Set(['&&', '||', ';', '\n']);

/** A script's commands, split at lines, `&&`, `||` and `;` outside quotes, each as its words, quotes and all. */
function segmentsOf(script: string): string[][] {
  const segments: string[][] = [[]];
  const words = /(?:"[^"]*"?|'[^']*'?|[^\s"';&|])+|&&|\|\||;|\n|[&|]/g;
  for (const [word] of script.matchAll(words)) {
    if (SEPARATORS.has(word)) segments.push([]);
    else segments.at(-1)!.push(word);
  }
  // A function's name, and a subshell's or block's brackets, aren't part of the command.
  return segments.map((words) =>
    words
      .slice(/^[\w-]+\(\)$/.test(words[0] ?? '') ? 1 : 0)
      .map((word, i) => (i ? word : word.replace(/^[({]+/, '')).replace(/[)}]+$/, ''))
      .filter(Boolean),
  );
}

function programOf(words: string[]): string | undefined {
  let i = 0;
  // Variables set for the command alone, a wrapper, or PowerShell's call operator.
  while (i < words.length) {
    const word = words[i]!;
    if (/^[A-Za-z_]\w*=/.test(word) || WRAPPERS.has(word) || word === '&') i++;
    else if (word === 'timeout') i += 2;
    else break;
  }
  const program = nameOf(words[i]);
  if (!program) return undefined;
  if (!SUBCOMMANDS.has(program)) return program;
  let next = i + 1;
  while (words[next]?.startsWith('-')) next += VALUED.has(words[next]!) ? 2 : 1;
  const sub = words[next];
  if (!sub || !/^[a-z][\w:-]*$/i.test(sub)) return program;
  if (sub === 'run' && RUNNERS.has(program)) {
    const script = words[next + 1];
    return script && /^[\w:.-]+$/.test(script) ? `${program} run ${script}` : `${program} run`;
  }
  return `${program} ${sub}`;
}

/** A program's name without its quotes, folders or `.exe`; undefined for what isn't one. */
function nameOf(word: string | undefined): string | undefined {
  if (!word) return undefined;
  const bare = word.replace(/^["']|["']$/g, '');
  const name = bare
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.(exe|cmd|bat)$/i, '');
  return PROGRAM.test(name) ? name : undefined;
}

/** A file's folder, with forward slashes and a capital drive letter, so one folder is one group. */
export function folderOf(file: unknown): string | undefined {
  if (typeof file !== 'string' || !file.trim()) return undefined;
  const path = file
    .trim()
    .replace(/\\/g, '/')
    .replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
  const end = path.lastIndexOf('/');
  if (end < 0) return undefined;
  return end === 0 || /^[A-Z]:$/.test(path.slice(0, end))
    ? path.slice(0, end + 1)
    : path.slice(0, end);
}

/** An address's site, without `www.`. */
export function siteOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}
