import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import type { SetupSource } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { type Chat } from '@ui/app/core/chat';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { ChatActions } from '@ui/app/core/chat-actions';
import { McpServers } from '@ui/app/core/mcp-servers';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';

/** The groups, in this order, each named for where its servers come from. */
const GROUPS: readonly { label: string; sources: readonly (SetupSource | undefined)[] }[] = [
  { label: 'Yours', sources: ['user', 'local'] },
  { label: 'Project', sources: ['project'] },
  { label: 'Plugins', sources: ['plugin'] },
  { label: 'Claude account', sources: ['account'] },
  { label: 'Managed', sources: ['managed', 'built-in'] },
  { label: 'No longer listed', sources: [undefined] },
];

interface Server {
  name: string;
  source: SetupSource | undefined;
  tokens: number | undefined;
  /** Off in every chat, as Settings says: it stays off here. */
  everywhere: boolean;
  on: boolean;
}

/**
 * The chat's MCP servers on its settings card: one line saying how many
 * are on and what they cost, and "Choose…" opening the list to turn them
 * off for this chat or on again, found by name and grouped by where they
 * come from. Those off in every chat are in Settings.
 */
@Component({
  selector: 'gr-mcp-picker',
  imports: [Icon],
  templateUrl: './mcp-picker.html',
  styleUrls: ['./settings-card-choices.css', './mcp-picker.css'],
  host: { role: 'group', 'aria-label': 'MCP servers', '[class.open]': 'open()' },
})
export class McpPicker {
  readonly chat = input.required<Chat>();

  protected readonly wording = inject(Wording);
  private readonly catalog = inject(AgentCatalog);
  private readonly actions = inject(ChatActions);
  private readonly settings = inject(Settings);
  private readonly mcp = inject(McpServers);
  private readonly filter = viewChild<ElementRef<HTMLInputElement>>('filter');

  /** Whether the list is open; shut again for another chat. */
  protected readonly open = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  protected readonly query = signal('');
  protected readonly begun = computed(() => this.chat().status !== 'blank');
  protected readonly agentName = computed(() => this.catalog.agentName(this.chat().agent));

  /**
   * The folder's MCP servers, and any turned off that it no longer lists,
   * each saying whether it's off here or in every chat; undefined until read.
   */
  protected readonly servers = computed((): Server[] | undefined => {
    const { agent, settings } = this.chat();
    const listed = this.mcp.of(agent, settings.cwd);
    if (!listed) return undefined;
    const everywhere = this.settings.all().mcpOff;
    const off = settings.mcpOff ?? [];
    const names = [...new Set([...listed.map((server) => server.name), ...off])];
    return names.map((name) => {
      const item = listed.find((server) => server.name === name);
      return {
        name,
        source: item?.source,
        tokens: item?.tokens,
        everywhere: everywhere.includes(name),
        on: !everywhere.includes(name) && !off.includes(name),
      };
    });
  });

  /** "12 of 70 on · 31,204 tokens": what the summary line says. */
  protected readonly summary = computed(() => {
    const servers = this.servers() ?? [];
    const on = servers.filter((server) => server.on);
    const tokens = on.reduce((sum, server) => sum + (server.tokens ?? 0), 0);
    return [
      `${on.length} of ${servers.length} on`,
      ...(tokens ? [this.tokenCount(tokens)] : []),
    ].join(' · ');
  });

  /** The servers whose name has what's written in the filter. */
  private readonly shown = computed(() => {
    const query = this.query().trim().toLowerCase();
    return (this.servers() ?? []).filter((server) => server.name.toLowerCase().includes(query));
  });

  /** The servers shown, by group, each group's in alphabetical order. */
  protected readonly groups = computed(() =>
    GROUPS.map(({ label, sources }) => ({
      label,
      servers: this.shown()
        .filter((server) => sources.includes(server.source))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((group) => group.servers.length),
  );

  /** Whether the filter narrows the list, so "All on" and "All off" mean the ones shown. */
  protected readonly filtered = computed(() => !!this.query().trim());

  constructor() {
    effect(() => {
      const { agent, settings } = this.chat();
      this.mcp.load(agent, settings.cwd);
    });
    afterRenderEffect(() => this.filter()?.nativeElement.focus());
  }

  protected toggleOpen(): void {
    this.open.update((open) => !open);
    this.query.set('');
  }

  protected close(event: Event): void {
    // Esc shuts the list; the card stays open.
    event.preventDefault();
    this.open.set(false);
    this.query.set('');
  }

  /** Turns an MCP server off for the chat, or on again; one off in every chat stays off. */
  protected toggle(server: Server): void {
    if (server.everywhere) return;
    const off = this.chat().settings.mcpOff ?? [];
    this.setOff(
      off.includes(server.name) ? off.filter((n) => n !== server.name) : [...off, server.name],
    );
  }

  /** Turns the servers shown on, or off, for the chat. */
  protected setAll(on: boolean): void {
    const names = this.shown()
      .filter((server) => !server.everywhere)
      .map((server) => server.name);
    const off = (this.chat().settings.mcpOff ?? []).filter((name) => !names.includes(name));
    this.setOff(on ? off : [...off, ...names]);
  }

  protected tokenCount(tokens: number | undefined): string {
    return tokens ? `${tokens.toLocaleString()} tokens` : '';
  }

  private setOff(mcpOff: string[]): void {
    void this.actions.configure(this.chat().id, { mcpOff });
  }
}
