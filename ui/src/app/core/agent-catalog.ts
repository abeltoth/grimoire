import { Injectable, inject, signal } from '@angular/core';
import type {
  AgentCapability,
  AgentId,
  AgentInfo,
  AgentModels,
  ChatSummary,
  EffortLevel,
  NewChatSettings,
  RecentFolders,
} from '@grimoire/contract';
import { fitEffort } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/**
 * The agents the service runs, with their models, and the folders chats
 * work in, so a chat's settings show names rather than IDs.
 */
@Injectable({ providedIn: 'root' })
export class AgentCatalog {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly agents = signal<readonly AgentInfo[]>([]);
  /** Each agent's models, once it has listed them. */
  readonly models = signal<Readonly<Record<AgentId, AgentModels>>>({});
  readonly folders = signal<RecentFolders>({ home: '', recent: [] });

  constructor() {
    this.bridge.invoke('agents.list', {}).then(
      (agents) => {
        this.agents.set(agents ?? []);
        for (const { id } of agents ?? []) void this.loadModels(id);
      },
      () => {},
    );
    void this.loadFolders();
  }

  /** Whether the agent does this, such as renaming its chats. */
  can(agent: AgentId | undefined, capability: AgentCapability): boolean {
    return !!this.agents()
      .find((info) => info.id === agent)
      ?.capabilities.includes(capability);
  }

  agentName(agent: AgentId): string {
    return this.agents().find((info) => info.id === agent)?.name ?? agent;
  }

  /** The model's name, or the agent's default model's when it names none. */
  modelName(agent: AgentId, model: string | undefined): string {
    const listed = this.models()[agent];
    const id = model ?? listed?.default;
    return listed?.models.find((m) => m.id === id)?.name ?? model ?? 'Default model';
  }

  /**
   * The model as a chat shows it; on Auto, "Auto" until its first message,
   * then with the model Auto picked: "Auto: Sonnet 5.5".
   */
  modelLabel(agent: AgentId, settings: NewChatSettings, begun: boolean): string {
    if (!settings.autoModel) return this.modelName(agent, settings.model);
    return begun ? `Auto: ${this.modelName(agent, settings.model)}` : 'Auto';
  }

  /**
   * The effort levels a chat's model takes, and the one it runs at: the
   * chat's own, else the model's default, as near as the model takes it.
   */
  effortOf(
    agent: AgentId,
    settings: { model?: string; effort?: EffortLevel },
  ): { levels: readonly EffortLevel[]; level?: EffortLevel } {
    const listed = this.models()[agent];
    const id = settings.model ?? listed?.default;
    const model = listed?.models.find((m) => m.id === id);
    const levels = model?.efforts ?? [];
    return { levels, level: fitEffort(settings.effort ?? model?.effort, levels) };
  }

  /** A folder as you'd write it, with your home folder as ~. */
  folderName(cwd: string | undefined): string {
    const { home } = this.folders();
    if (!cwd) return '~';
    const rest = home && cwd.startsWith(home) ? cwd.slice(home.length) : undefined;
    return rest === '' || (rest !== undefined && /^[\\/]/.test(rest)) ? `~${rest}` : cwd;
  }

  /** Lists the recent folders again, for the settings card. */
  async loadFolders(): Promise<void> {
    try {
      const folders = await this.bridge.invoke('agents.folders', {});
      if (folders) this.folders.set(folders);
    } catch {
      // Keep the folders listed before.
    }
  }

  /** Every agent's chats, most recent first. */
  async pastChats(): Promise<ChatSummary[]> {
    const lists = await Promise.all(
      this.agents().map((agent) =>
        this.bridge.invoke('agents.chats', { agent: agent.id }).catch(() => []),
      ),
    );
    return lists.flatMap((list) => list ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async loadModels(agent: AgentId): Promise<void> {
    try {
      const models = await this.bridge.invoke('agents.models', { agent });
      if (models) this.models.update((all) => ({ ...all, [agent]: models }));
    } catch {
      // The agent couldn't list its models: settings show the model's ID.
    }
  }
}
