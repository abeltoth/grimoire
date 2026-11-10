import type { GrimoireSettings } from '@grimoire/contract';

/** What a Claude Code process takes from the settings as it starts, and keeps until it stops. */
type StartedWith = Pick<GrimoireSettings, 'mcpOff' | 'suggestions' | 'followUps'>;

/**
 * Starts Claude Code's processes again when what they start with changes,
 * since a running process can't take it in: the spare at once, an open
 * chat's when it next starts.
 */
export class ClaudeRestarts {
  private started: StartedWith;

  constructor(
    private readonly claude: { dispose(): void; warm(): void },
    private readonly hub: { mcpChanged(): void },
    private readonly settings: () => GrimoireSettings,
  ) {
    this.started = startedWith(settings());
  }

  /** The settings changed. */
  settingsChanged(settings: GrimoireSettings): void {
    const { mcpOff, suggestions, followUps } = this.started;
    // Suggestions, or separate tasks, turned on or off: the spare starts again with them; open chats, when theirs next does.
    if (settings.suggestions !== suggestions || settings.followUps !== followUps) {
      this.started = {
        ...this.started,
        suggestions: settings.suggestions,
        followUps: settings.followUps,
      };
      this.claude.dispose();
      this.claude.warm();
    }
    // Other MCP servers off in every chat: the open chats, and the spare, start again with them.
    const now = settings.mcpOff;
    if (now.length === mcpOff.length && now.every((name) => mcpOff.includes(name))) return;
    this.started = { ...this.started, mcpOff: now };
    this.hub.mcpChanged();
    this.claude.dispose();
    this.claude.warm();
  }

  /** Another profile is in use: the spare starts with its settings, which don't restart it. */
  profileSwitched(): void {
    this.started = startedWith(this.settings());
    this.claude.warm();
  }
}

function startedWith({ mcpOff, suggestions, followUps }: GrimoireSettings): StartedWith {
  return { mcpOff, suggestions, followUps };
}
