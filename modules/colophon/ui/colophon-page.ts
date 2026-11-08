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
import {
  type AgentId,
  type GrimoireSettings,
  PERSONAL_PROFILE,
  type Preset,
  type Profile,
} from '@grimoire/contract';
import { Chats } from '@ui/app/core/chats';
import { McpServers } from '@ui/app/core/mcp-servers';
import { PresetList } from '@ui/app/core/preset-list';
import { Presets } from '@ui/app/core/presets';
import { Profiles } from '@ui/app/core/profiles';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import { Accounts } from './accounts';
import { ThemeEditor } from './theme-editor';

/**
 * The Colophon: how the book is made. Its settings are written out as
 * words to pick, the picked one underlined, and each is kept by the
 * service as soon as it's picked; among them, the account the agent signs
 * in as. Below them, the presets, each with the first entry its chapters
 * begin with, to rename or remove; then the theme. The MCP servers your
 * agents load in your home folder, and those turned off, can be turned off
 * or on in every chapter. Last, the profiles: each with its Claude folder,
 * to make, rename, switch to or delete.
 */
@Component({
  selector: 'gr-colophon-page',
  imports: [ThemeEditor],
  providers: [Accounts],
  templateUrl: './colophon-page.html',
  styleUrl: './colophon-page.css',
})
export class ColophonPage {
  protected readonly settings = inject(Settings);
  protected readonly chats = inject(Chats);
  protected readonly presets = inject(PresetList);
  protected readonly described = inject(Presets);
  protected readonly wording = inject(Wording);
  protected readonly accounts = inject(Accounts);
  protected readonly profiles = inject(Profiles);
  private readonly mcp = inject(McpServers);
  private readonly injector = inject(Injector);
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');
  private readonly accountField = viewChild<ElementRef<HTMLInputElement>>('accountField');
  private readonly profileField = viewChild<ElementRef<HTMLInputElement>>('profileField');
  private readonly newProfileField = viewChild<ElementRef<HTMLInputElement>>('newProfileField');

  /** While another account's email is being written. */
  protected readonly addingAccount = signal(false);
  /** The sign-in page's link was copied, for the sign-in it belongs to. */
  protected readonly copiedPage = signal<string | null>(null);

  /** The preset being renamed, by name. */
  protected readonly renaming = signal<string | null>(null);
  /** The preset asked about before it's removed. */
  protected readonly removing = signal<string | null>(null);

  /** The preset new chapters begin with, while it's still saved. */
  protected readonly startPreset = computed(() => {
    const start = this.settings.all().newChapter;
    return start.from === 'preset' && this.presets.all().some((p) => p.name === start.preset)
      ? start.preset
      : null;
  });

  /** Whether every agent has said which MCP servers it loads in your home folder. */
  protected readonly mcpRead = computed(() =>
    this.chats.agents().every((agent) => this.mcp.of(agent.id, this.home()) !== undefined),
  );

  /** The MCP servers your agents load in your home folder, and those turned off, by name. */
  protected readonly mcpServers = computed(() => {
    const listed = this.chats
      .agents()
      .flatMap((agent) => this.mcp.of(agent.id, this.home()) ?? [])
      .map((server) => server.name);
    return [...new Set([...listed, ...this.settings.all().mcpOff])];
  });

  private readonly home = computed(() => this.chats.folders().home || undefined);

  /** While a new profile's name is being written. */
  protected readonly creating = signal(false);
  /** The profile just made, which asks to be signed in. */
  protected readonly made = signal<string | null>(null);
  /** The profile being renamed, by ID. */
  protected readonly renamingProfile = signal<string | null>(null);
  /** The profile asked about before it's deleted, by ID. */
  protected readonly deleting = signal<string | null>(null);
  /** The profile just deleted, and where its Claude folder stays. */
  protected readonly deleted = signal<{ name: string; folder: string } | null>(null);
  /** The profile whose folder's path was copied, by ID. */
  protected readonly copiedFolder = signal<string | null>(null);

  /** Claude Code's usual place, ~/.claude, where Personal leaves it. */
  private readonly usualFolder = computed(() => {
    const home = this.chats.folders().home;
    if (!home) return '';
    return `${home}${home.includes('\\') ? '\\' : '/'}.claude`;
  });

  constructor() {
    void this.presets.load();
    effect(() => {
      for (const agent of this.chats.agents()) this.mcp.load(agent.id, this.home());
    });
    // Switched to a profile to sign it in: the account's email is asked for.
    effect(() => {
      if (!this.profiles.signInNext() || !this.accounts.agent()) return;
      untracked(() => {
        this.profiles.signInNext.set(false);
        this.startAddingAccount();
        afterNextRender(
          () =>
            document.getElementById('gr-colophon-account')?.scrollIntoView?.({ block: 'center' }),
          { injector: this.injector },
        );
      });
    });
  }

  /** The profile's Claude folder in full. */
  protected folderOf(profile: Profile): string {
    return profile.claudeFolder ?? this.usualFolder();
  }

  /** Whether the profile can be deleted: not Personal, nor the one in use. */
  protected deletable(profile: Profile): boolean {
    return profile.id !== PERSONAL_PROFILE && profile.id !== this.profiles.list().active;
  }

  /** Why a profile can't be deleted, shown on its Delete. */
  protected whyKept(profile: Profile): string | null {
    if (profile.id === PERSONAL_PROFILE) {
      return this.wording.say(
        'This volume uses Claude Code’s usual place, and stays',
        'This profile uses Claude Code’s usual place, and stays',
      );
    }
    if (profile.id === this.profiles.list().active) {
      return this.wording.say(
        'Open another volume to delete this one',
        'Switch to another profile to delete this one',
      );
    }
    return null;
  }

  protected async copyFolder(profile: Profile): Promise<void> {
    await navigator.clipboard.writeText(this.folderOf(profile));
    this.copiedFolder.set(profile.id);
  }

  protected startCreating(): void {
    this.creating.set(true);
    afterNextRender(() => this.newProfileField()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /** Makes the profile named, once; Enter and leaving the field both end it. */
  protected async create(name: string): Promise<void> {
    if (!this.creating()) return;
    this.creating.set(false);
    if (!name.trim()) return;
    const profile = await this.profiles.create(name);
    if (profile) this.made.set(profile.id);
  }

  protected startRenamingProfile(id: string): void {
    this.deleting.set(null);
    this.renamingProfile.set(id);
    afterNextRender(
      () => {
        const field = this.profileField()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  /** Keeps the name written, once; Enter and leaving the field both end the renaming. */
  protected renameProfile(profile: Profile, to: string): void {
    if (this.renamingProfile() !== profile.id) return;
    this.renamingProfile.set(null);
    if (to.trim() && to.trim() !== profile.name) void this.profiles.rename(profile.id, to);
  }

  protected async deleteProfile(profile: Profile): Promise<void> {
    this.deleting.set(null);
    const folder = this.folderOf(profile);
    if (await this.profiles.remove(profile.id)) this.deleted.set({ name: profile.name, folder });
  }

  /** Turns an MCP server off in every chapter, or on again. */
  protected toggleMcp(name: string): void {
    const off = this.settings.all().mcpOff;
    this.set({ mcpOff: off.includes(name) ? off.filter((n) => n !== name) : [...off, name] });
  }

  protected set(change: Partial<GrimoireSettings>): void {
    void this.settings.set(change);
  }

  protected pickAgent(agent: AgentId | null): void {
    this.set({ defaultAgent: agent });
  }

  protected pickStart(preset: string | null): void {
    this.set({ newChapter: preset ? { from: 'preset', preset } : { from: 'last-used' } });
  }

  protected startRenaming(name: string): void {
    this.removing.set(null);
    this.renaming.set(name);
    afterNextRender(
      () => {
        const field = this.nameField()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  /** Keeps the name written, once; Enter and leaving the field both end the renaming. */
  protected rename(from: string, to: string): void {
    if (this.renaming() !== from) return;
    this.renaming.set(null);
    if (to.trim() && to.trim() !== from) void this.presets.rename(from, to);
  }

  protected remove(name: string): void {
    this.removing.set(null);
    void this.presets.remove(name);
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

  protected setPrompt(preset: Preset, prompt: string): void {
    if (prompt.trim() !== (preset.prompt ?? '')) void this.presets.setPrompt(preset, prompt);
  }
}
