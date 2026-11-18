/** The shells a command runs in, by their highlighter language. */
export type Shell = 'bash' | 'powershell';

/** A script a command feeds in, such as a heredoc's body, and the language it's in. */
export interface CommandScript {
  /** What it is: a language, a file it writes, or a message. */
  label: string;
  /** Its highlighter language; empty for plain text. */
  lang: string;
  code: string;
}

/** A command, its scripts set apart. */
export interface CommandParts {
  command: string;
  scripts: CommandScript[];
}

/** A bash heredoc's opener, `<<EOF`, `<<'EOF'` or `<<-EOF`, but not a here-string `<<<`. */
const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/;

/** A PowerShell here-string's opener, `@'` or `@"`, ending its line. */
const HERE_STRING = /@(['"])\s*$/;

const FILE_LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  py: 'python',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  toml: 'toml',
  xml: 'xml',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
};

/** Programs a script is fed to, by the language they read. */
const READERS: [RegExp, string][] = [
  [/\bpython(?:3(?:\.\d+)?)?(?:\.exe)?\b/i, 'python'],
  [/\bnode(?:\.exe)?\b/i, 'javascript'],
  [/\b(?:tsx|ts-node|deno|bun)\b/i, 'typescript'],
  [/\b(?:bash|sh|zsh)\b/, 'bash'],
  [/\b(?:pwsh|powershell)(?:\.exe)?\b/i, 'powershell'],
  [/\b(?:psql|sqlite3|mysql)\b/, 'sql'],
];

/** The last file the text writes to, by a redirect, tee or a PowerShell cmdlet. */
function fileOf(text: string): string | undefined {
  const writes = [
    ...text.matchAll(/(?:^|[^\d&>])>{1,2}\s*(['"]?)([^\s'"|;&<>()]+)\1/g),
    ...text.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'"|;&<>()]+)\1/g),
    ...text.matchAll(
      /\b(?:Set-Content|Add-Content|Out-File)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?(['"]?)([^\s'"|;-][^\s'"|;]*)\1/gi,
    ),
  ];
  return writes
    .sort((a, b) => a.index - b.index)
    .map((write) => write[2]!)
    .filter((file) => !/^\/dev\//.test(file) && !/^\$null$/i.test(file))
    .at(-1);
}

/** What a script is, from the command around it. */
function scriptOf(around: string): Omit<CommandScript, 'code'> {
  if (/\bgit\s+(?:commit|tag)\b/.test(around)) return { label: 'message', lang: '' };
  if (/\bgh\s+(?:pr|issue|release)\b/.test(around)) return { label: 'body', lang: 'markdown' };
  const file = fileOf(around);
  if (file) {
    const name = file.split(/[\\/]/).at(-1)!;
    return { label: name, lang: FILE_LANGS[name.split('.').at(-1)!.toLowerCase()] ?? '' };
  }
  // The program the script is fed to is the last one before it.
  const program = around.split(/&&|\|\||;|\|/).at(-1) ?? '';
  for (const [reader, lang] of READERS) if (reader.test(program)) return { label: lang, lang };
  return { label: 'text', lang: '' };
}

/** Where a script opens on a line, and how to tell the line that closes it. */
interface Opener {
  before: string;
  closes: (line: string) => boolean;
  /** What follows the close on its line, which is part of the command. */
  after: (line: string) => string;
}

function openerOf(line: string, shell: Shell): Opener | undefined {
  if (shell === 'bash') {
    const heredoc = HEREDOC.exec(line);
    if (!heredoc) return undefined;
    const [, dash, , word] = heredoc;
    return {
      before: line.slice(0, heredoc.index) + line.slice(heredoc.index + heredoc[0].length),
      closes: (l) => (dash ? l.replace(/^\t+/, '') : l).trimEnd() === word,
      after: () => '',
    };
  }
  const here = HERE_STRING.exec(line);
  if (!here) return undefined;
  const close = `${here[1]}@`;
  return {
    before: line.slice(0, here.index),
    closes: (l) => l.startsWith(close),
    after: (l) => l.slice(close.length).trim(),
  };
}

/**
 * A command with each heredoc (or PowerShell here-string) set apart as a
 * script, labelled by what reads it: the command keeps the line that opens
 * it, and the script is its body. An unclosed one stays in the command.
 */
export function commandParts(command: string, shell: Shell): CommandParts {
  const lines = command.split(/\r?\n/);
  const kept: string[] = [];
  const scripts: CommandScript[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    kept.push(line);
    const opener = openerOf(line, shell);
    if (!opener) continue;
    const end = lines.findIndex((l, j) => j > i && opener.closes(l));
    if (end < 0) continue;
    const after = opener.after(lines[end]!);
    scripts.push({
      ...scriptOf(`${opener.before} ${after}`),
      code: lines.slice(i + 1, end).join('\n'),
    });
    if (after) kept.push(lines[end]!);
    i = end;
  }
  return { command: kept.join('\n'), scripts };
}
