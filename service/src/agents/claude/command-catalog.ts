import type { FastModeState, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentCommand,
  CommandChoice,
  CommandGroup,
  CommandOwner,
  CommandRun,
} from '@grimoire/contract';

/** What Claude Code says as it starts: its commands, and the settings some of them change. */
export interface CommandSource {
  commands: readonly SlashCommand[];
  /** The names of its skills, which it lists among its commands. */
  skills: ReadonlySet<string>;
  outputStyle?: string;
  outputStyles?: readonly string[];
  fastMode?: FastModeState;
}

/** Commands that mean something only in a terminal, or that Grimoire shows its own way. */
const HIDDEN = new Set([
  'agents',
  'auto-mode-setup',
  'color',
  'extra-usage',
  'focus',
  'heapdump',
  'mcp',
  'workflow-launch-exec',
]);

const GROUPS: Readonly<Record<string, CommandGroup>> = {
  model: 'settings',
  effort: 'settings',
  advisor: 'settings',
  fast: 'settings',
  'output-style': 'settings',
  autocompact: 'settings',
  config: 'settings',
  context: 'reports',
  usage: 'reports',
  'list-agents': 'reports',
  insights: 'reports',
  recap: 'reports',
  'skill-doctor': 'reports',
};

const OWNERS: Readonly<Record<string, CommandOwner>> = {
  model: 'model',
  effort: 'effort',
  clear: 'new-chat',
  rename: 'rename',
};

/** Commands whose hint doesn't say how they're used: what follows them is yours to write, or nothing. */
const RUNS: Readonly<Record<string, CommandRun>> = {
  autocompact: 'compose',
  config: 'compose',
  goal: 'compose',
  compact: 'now',
};

/** The chat's permission, which Grimoire keeps and Claude Code changes only in a terminal. */
const PERMISSIONS: AgentCommand = {
  name: 'permissions',
  description: 'Set what the agent may do without asking',
  group: 'settings',
  run: 'pick',
  owner: 'mode',
};

/** Claude Code's commands and skills as the command palette lists them, with how each runs. */
export function catalog(source: CommandSource): AgentCommand[] {
  const seen = new Set<string>();
  const listed = source.commands.flatMap((command): AgentCommand[] => {
    const { name, description, argumentHint } = command;
    // Names with two underscores are Claude Code's own plumbing; a name listed twice runs the first.
    if (name.startsWith('__') || seen.has(name)) return [];
    seen.add(name);
    const hint = argumentHint ? { argumentHint } : {};
    if (source.skills.has(name))
      return [{ name, description, ...hint, group: 'skills', run: 'compose' }];
    if (HIDDEN.has(name)) return [];
    const owner = OWNERS[name];
    const choices = owner ? [] : choicesOf(name, argumentHint, source);
    return [
      {
        name,
        description,
        ...hint,
        group: GROUPS[name] ?? 'chat',
        run: runOf(name, argumentHint, owner, choices),
        ...(choices.length ? { choices } : {}),
        ...(owner ? { owner } : {}),
      },
    ];
  });
  return [...listed, PERMISSIONS];
}

function runOf(
  name: string,
  hint: string | undefined,
  owner: CommandOwner | undefined,
  choices: CommandChoice[],
): CommandRun {
  if (owner === 'new-chat' || owner === 'rename') return 'now';
  if (owner || choices.length) return 'pick';
  const run = RUNS[name];
  if (run) return run;
  // A hint in brackets is optional: the command runs without it.
  return !hint?.trim() || hint.trim().startsWith('[') ? 'now' : 'compose';
}

/** The values a command takes, as its hint lists them, or as Claude Code reports them. */
function choicesOf(name: string, hint: string | undefined, source: CommandSource): CommandChoice[] {
  if (name === 'output-style')
    return (source.outputStyles ?? []).map((value) => ({
      value,
      ...(value === source.outputStyle ? { current: true as const } : {}),
    }));
  const values = alternatives(hint);
  if (name === 'fast' && source.fastMode) {
    const now = source.fastMode === 'off' ? 'off' : 'on';
    return values.map((value) => ({ value, ...(value === now ? { current: true as const } : {}) }));
  }
  return values.map((value) => ({ value }));
}

/** "[on|off]" or "consent | revoke": the words it takes; none when it takes anything else too. */
function alternatives(hint: string | undefined): string[] {
  const inner = hint?.trim().replace(/^[[<](.*)[\]>]$/, '$1') ?? '';
  const values = inner.split('|').map((value) => value.trim());
  return values.length > 1 && values.every((value) => /^[a-z0-9-]+$/i.test(value)) ? values : [];
}
