/** The input field each of Claude Code's tools names what it ran on with. */
const FIELDS: Record<string, string> = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Bash: 'command',
  PowerShell: 'command',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  ToolSearch: 'query',
  Task: 'description',
  Agent: 'description',
};

/** The longest target kept: a long command is known by its start. */
const LONGEST = 200;

/** What a tool call ran on, such as a file, command or address; undefined for a tool without one. */
export function targetOf(tool: string, input: unknown): string | undefined {
  const field = FIELDS[tool];
  const value = field ? (input as Record<string, unknown> | null)?.[field] : undefined;
  if (typeof value !== 'string') return undefined;
  const line = value.trim().split('\n')[0]!.trim();
  if (!line) return undefined;
  return line.length > LONGEST ? `${line.slice(0, LONGEST - 1)}…` : line;
}
