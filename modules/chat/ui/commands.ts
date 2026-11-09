/** What a shell command did, told by the programs it ran. */
export type CommandDeed = 'read' | 'searched' | 'tested' | 'committed' | 'ran';

/** Programs that only show a file. */
const READERS = new Set(['cat', 'head', 'tail', 'sed', 'wc', 'less', 'more', 'get-content', 'gc', 'type']);

/** Programs that look for files or text. */
const SEARCHERS = new Set(['grep', 'rg', 'egrep', 'find', 'ls', 'tree', 'select-string', 'get-childitem', 'dir', 'gci']);

/** Programs that run around the work without doing any of it: moving about, saying something. */
const ASIDES = new Set(['cd', 'pushd', 'popd', 'echo', 'printf', 'true', 'set-location', 'write-output', 'write-host']);

/** A test runner, as the start of what a command ran. */
const TESTS = /^(npm|pnpm|yarn)( run)? test\b|^(npx )?(vitest|jest|mocha|pytest|playwright test)\b|^(npx )?ng test\b|^go test\b|^cargo test\b|^dotnet test\b/;

/**
 * What a shell command did: read, searched, tested or committed when all it
 * ran did that, besides moving about and saying something; else it ran.
 */
export function deedOf(command: string): CommandDeed {
  const deeds = new Set<Deed>();
  for (const part of partsOf(command)) deeds.add(deedOfPart(part));
  deeds.delete('aside');
  // Staging and looking at the repository go with a commit; on their own, they ran git.
  if (deeds.has('committed')) deeds.delete('git');
  else if (deeds.delete('git')) deeds.add('ran');
  return deeds.size === 1 ? ([...deeds][0] as CommandDeed) : 'ran';
}

/** The commands a command line runs, one after another: each pipe's first, the text a here-document feeds left out. */
function partsOf(command: string): string[] {
  const lines: string[] = [];
  let until: string | undefined;
  for (const line of command.split(/\r?\n/)) {
    if (until !== undefined) {
      if (line.trim() === until) until = undefined;
      continue;
    }
    lines.push(line);
    until = /<<-?\s*['"]?(\w+)['"]?/.exec(line)?.[1];
  }
  return lines
    .join('\n')
    .split(/&&|\|\||;|\n/)
    .map((part) => part.split(/(?<!\\)\|/)[0]!.trim().replace(/^[({\s]+/, ''))
    .filter(Boolean);
}

/** A part's deed; an aside, or git other than a commit, doesn't count by itself. */
type Deed = CommandDeed | 'aside' | 'git';

function deedOfPart(part: string): Deed {
  const words = part.split(/\s+/).filter((word) => !/^\w+=/.test(word));
  const program = (words[0] ?? '').split(/[\\/]/).at(-1)!.toLowerCase();
  const line = words.join(' ');
  if (ASIDES.has(program)) return 'aside';
  if (TESTS.test(line)) return 'tested';
  if (program === 'git') {
    // Past git's own options, such as -C and the folder it names.
    let at = 1;
    while (words[at]?.startsWith('-')) at += /^-[Cc]$/.test(words[at]!) ? 2 : 1;
    const sub = words[at] ?? '';
    if (sub === 'commit' || sub === 'push') return 'committed';
    return sub === 'grep' ? 'searched' : 'git';
  }
  // Writing to a file, or sed changing one in place, isn't reading.
  const writes = /(?<![0-9&])>/.test(part) || (program === 'sed' && /\s-i/.test(part));
  if (READERS.has(program)) return writes ? 'ran' : 'read';
  if (SEARCHERS.has(program)) return writes ? 'ran' : 'searched';
  return 'ran';
}
