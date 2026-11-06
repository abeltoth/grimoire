import {
  Component,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  type AgentInfo,
  type AgentSetup,
  SETUP_SECTIONS,
  type SetupItem,
  type SetupSection,
  type SetupSource,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';

/** An agent that can say what it loads, and what it said. */
interface Told {
  agent: AgentInfo;
  setup: AgentSetup;
}

const SECTION_NAMES: Record<SetupSection, string> = {
  memory: 'Memory',
  skills: 'Skills',
  agents: 'Subagents',
  commands: 'Commands',
  hooks: 'Hooks',
  mcpServers: 'MCP servers',
  plugins: 'Plugins',
  permissions: 'Permissions',
};

const SOURCE_NAMES: Record<SetupSource, string> = {
  user: 'Yours',
  project: 'Project',
  local: 'Yours, here',
  managed: 'Managed',
  plugin: 'Plugin',
  account: 'Claude account',
  'built-in': 'Built in',
};

/**
 * The Front matter: everything an agent loads when it works in a folder,
 * the open chapter's until you pick another, and where each piece comes
 * from: memory, skills, subagents, commands, hooks, MCP servers, plugins
 * and permission rules, each with what it costs the context.
 */
@Component({
  selector: 'gr-front-matter-page',
  templateUrl: './front-matter-page.html',
  styleUrl: './front-matter-page.css',
})
export class FrontMatterPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);

  protected readonly sections = SETUP_SECTIONS;

  /** The folder you picked; the open chapter's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.chats.current()?.settings.cwd);

  /** What the agents told; undefined until they've answered. */
  protected readonly told = signal<Told[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);
  /** The last read asked for, so an earlier answer arriving late is dropped. */
  private asked = 0;

  constructor() {
    // Read once the agents are known, and again for another folder.
    effect(() => {
      const cwd = this.cwd();
      if (this.chats.agents().length) untracked(() => void this.read(cwd));
    });
  }

  protected async read(cwd = this.cwd()): Promise<void> {
    const ask = ++this.asked;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.chats.agents();
      const answers = await Promise.all(
        agents.map((agent) =>
          this.bridge.invoke('agents.setup', { agent: agent.id, ...(cwd ? { cwd } : {}) }),
        ),
      );
      if (ask !== this.asked) return;
      this.told.set(
        agents.flatMap((agent, i) => {
          const setup = answers[i];
          return setup ? [{ agent, setup }] : [];
        }),
      );
    } catch (error) {
      if (ask === this.asked)
        this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      if (ask === this.asked) this.reading.set(false);
      done();
    }
  }

  protected async pickFolder(): Promise<void> {
    const folder = await this.bridge.chooseFolder();
    if (folder) this.picked.set(folder);
  }

  protected name(section: SetupSection): string {
    return SECTION_NAMES[section];
  }

  /** Where it comes from: the plugin that brings it, or whose it is. */
  protected from(item: { source: SetupSource; plugin?: string }): string {
    return item.plugin ?? SOURCE_NAMES[item.source];
  }

  /** What the items cost the context in all, such as "6,481 tokens"; empty when the agent didn't say. */
  protected cost(items: readonly SetupItem[]): string {
    const tokens = items.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
    return tokens ? this.tokens(tokens) : '';
  }

  protected tokens(count: number | undefined): string {
    return count ? `${count.toLocaleString()} ${count === 1 ? 'token' : 'tokens'}` : '';
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
