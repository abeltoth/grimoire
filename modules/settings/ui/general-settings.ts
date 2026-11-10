import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type AgentId, DEFAULT_JIRA_QUERY, type GrimoireSettings } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { McpServers } from '@ui/app/core/mcp-servers';
import { PresetList } from '@ui/app/core/preset-list';
import { Profiles } from '@ui/app/core/profiles';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import { Accounts } from './accounts';

/**
 * The Settings page's settings, written out as words to pick, the picked
 * one underlined, each kept by the service as soon as it's picked. The MCP
 * servers your agents load in your home folder, and those turned off, can
 * be turned off or on in every chat; the Jira query picks the issues on
 * the Kanban board; last, the account the agent signs in as.
 */
@Component({
  selector: 'gr-general-settings',
  providers: [Accounts],
  templateUrl: './general-settings.html',
  styleUrls: ['./general-settings.css', './settings-sections.css'],
})
export class GeneralSettings {
  protected readonly settings = inject(Settings);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly presets = inject(PresetList);
  protected readonly wording = inject(Wording);
  protected readonly accounts = inject(Accounts);
  private readonly profiles = inject(Profiles);
  private readonly mcp = inject(McpServers);
  private readonly injector = inject(Injector);
  private readonly accountField = viewChild<ElementRef<HTMLInputElement>>('accountField');

  /** While another account's email is being written. */
  protected readonly addingAccount = signal(false);
  /** The sign-in page's link was copied, for the sign-in it belongs to. */
  protected readonly copiedPage = signal<string | null>(null);

  /** The preset new chats begin with, while it's still saved. */
  protected readonly startPreset = computed(() => {
    const start = this.settings.all().newChat;
    return start.from === 'preset' && this.presets.all().some((p) => p.name === start.preset)
      ? start.preset
      : null;
  });

  /** Whether every agent has said which MCP servers it loads in your home folder. */
  protected readonly mcpRead = computed(() =>
    this.catalog.agents().every((agent) => this.mcp.of(agent.id, this.home()) !== undefined),
  );

  /** The MCP servers your agents load in your home folder, and those turned off, by name. */
  protected readonly mcpServers = computed(() => {
    const listed = this.catalog
      .agents()
      .flatMap((agent) => this.mcp.of(agent.id, this.home()) ?? [])
      .map((server) => server.name);
    return [...new Set([...listed, ...this.settings.all().mcpOff])];
  });

  private readonly home = computed(() => this.catalog.folders().home || undefined);

  constructor() {
    effect(() => {
      for (const agent of this.catalog.agents()) this.mcp.load(agent.id, this.home());
    });
    // Switched to a profile to sign it in: the account's email is asked for.
    effect(() => {
      if (!this.profiles.signInNext() || !this.accounts.agent()) return;
      untracked(() => {
        this.profiles.signInNext.set(false);
        this.startAddingAccount();
        afterNextRender(
          () =>
            document.getElementById('gr-settings-account')?.scrollIntoView?.({ block: 'center' }),
          { injector: this.injector },
        );
      });
    });
  }

  /** Turns an MCP server off in every chat, or on again. */
  protected toggleMcp(name: string): void {
    const off = this.settings.all().mcpOff;
    this.set({ mcpOff: off.includes(name) ? off.filter((n) => n !== name) : [...off, name] });
  }

  protected set(change: Partial<GrimoireSettings>): void {
    void this.settings.set(change);
  }

  /** Keeps the Jira query written; emptied, it's the one the board began with. */
  protected setJiraQuery(field: HTMLTextAreaElement): void {
    const query = field.value.trim() || DEFAULT_JIRA_QUERY;
    field.value = query;
    if (query !== this.settings.all().jiraQuery) this.set({ jiraQuery: query });
  }

  protected pickAgent(agent: AgentId | null): void {
    this.set({ defaultAgent: agent });
  }

  protected pickStart(preset: string | null): void {
    this.set({ newChat: preset ? { from: 'preset', preset } : { from: 'last-used' } });
  }

  protected startAddingAccount(): void {
    this.addingAccount.set(true);
    afterNextRender(() => this.accountField()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Signs in to the account written, which is kept to switch to again. */
  protected addAccount(email: string): void {
    if (!this.addingAccount()) return;
    this.addingAccount.set(false);
    if (email.trim()) void this.accounts.signIn(email);
  }

  /** Copies the sign-in page's link, to open in a browser by hand. */
  protected async copyPage(url: string): Promise<void> {
    await navigator.clipboard.writeText(url);
    this.copiedPage.set(url);
  }

  /** The subscription's name, such as "Pro"; empty when the agent doesn't say. */
  protected planName(plan: string | null): string {
    return plan ? plan[0]!.toUpperCase() + plan.slice(1) : '';
  }

  /** The day a sign-in runs out, such as "6 December". */
  protected day(at: number): string {
    return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'long' });
  }
}
