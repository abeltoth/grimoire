import {
  Component,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { AgentCommand, AgentId } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatActions } from '@ui/app/core/chat-actions';
import { ChatList } from '@ui/app/core/chat-list';
import { NewChats } from '@ui/app/core/new-chats';

/** A check of the agent's own setup, run as one of its slash commands in a new chat. */
interface Check {
  id: string;
  /** The agent's command it runs; the check shows only where the agent offers it. */
  command: string;
  args?: string;
  title: string;
  /** What it does for you, in one line. */
  does: string;
  /** What it changes on disk, shown on hover over its mark; without it, it only reports back. */
  changes?: string;
}

/** The checks, the broadest first. */
const CHECKS: readonly Check[] = [
  {
    id: 'checkup',
    command: 'doctor',
    title: 'Full checkup',
    does: 'Looks over your whole setup and suggests what to trim, fix or update.',
    changes: 'Can fix what it finds in your setup files.',
  },
  {
    id: 'prompt-audit',
    command: 'doctor',
    args: 'prompt-audit',
    title: 'Clean up instructions',
    does: 'Finds outdated or contradicting rules in your CLAUDE.md files, skills and agents.',
  },
  {
    id: 'unused-skills',
    command: 'skill-doctor',
    title: 'Unused skills',
    does: 'Lists the skills that take up room in every chat but never get used.',
  },
  {
    id: 'fewer-prompts',
    command: 'fewer-permission-prompts',
    title: 'Fewer approvals',
    does: 'Lets the safe commands you keep approving run without asking.',
    changes: 'Edits .claude/settings.json in this folder.',
  },
  {
    id: 'insights',
    command: 'insights',
    title: 'Session report',
    does: 'A report analyzing your past sessions.',
  },
];

/** What the check sends, such as "/doctor prompt-audit". */
function slashText(check: Check): string {
  return `/${check.command}${check.args ? ` ${check.args}` : ''}`;
}

/**
 * The Tune-up section of the Settings page: checks of the agent's own
 * setup for a folder, the open chat's until you pick another, each told
 * in a line and run in a new chat there.
 */
@Component({
  selector: 'gr-optimize-settings',
  templateUrl: './optimize-settings.html',
  styleUrl: './optimize-settings.css',
})
export class OptimizeSettings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);
  private readonly newChats = inject(NewChats);
  private readonly actions = inject(ChatActions);
  private readonly pending = inject(PendingTasks);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly slashText = slashText;

  /** The folder you picked; the open chat's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.list.current()?.settings.cwd);
  /** The open chat's agent, else the one new chats begin with. */
  private readonly agent = computed<AgentId>(
    () => this.list.current()?.agent ?? this.newChats.startOf().agent,
  );
  protected readonly agentName = computed(() => this.catalog.agentName(this.agent()));

  /** The agent's commands in the folder; undefined until it has answered. */
  private readonly commands = signal<readonly AgentCommand[] | undefined>(undefined);
  protected readonly failed = signal<string | null>(null);
  private asked = 0;

  /** The checks the agent offers in the folder; the section shows only with some. */
  protected readonly offered = computed(() => {
    const names = new Set((this.commands() ?? []).map((command) => command.name));
    return CHECKS.filter((check) => names.has(check.command));
  });

  constructor() {
    effect(() => {
      const agent = this.agent();
      const cwd = this.cwd();
      untracked(() => void this.load(agent, cwd));
    });
  }

  private async load(agent: AgentId, cwd: string | undefined): Promise<void> {
    const ask = ++this.asked;
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const commands = await this.bridge.invoke('agents.commands', {
        agent,
        ...(cwd ? { cwd } : {}),
      });
      if (ask === this.asked) this.commands.set(commands ?? []);
    } catch (error) {
      if (ask === this.asked) this.failed.set(error instanceof Error ? error.message : `${error}`);
    } finally {
      done();
    }
  }

  /** Opens a new chat in the folder, with the agent, and sends the check's command there. */
  protected run(check: Check): void {
    const agent = this.agent();
    const cwd = this.cwd();
    const start = this.newChats.startOf();
    const settings = start.agent === agent ? start.settings : {};
    const id = this.list.newChat({ agent, settings: { ...settings, ...(cwd ? { cwd } : {}) } });
    void this.actions.send(id, slashText(check));
  }

  protected async pickFolder(): Promise<void> {
    const folder = await this.bridge.chooseFolder();
    if (folder) this.picked.set(folder);
  }
}
