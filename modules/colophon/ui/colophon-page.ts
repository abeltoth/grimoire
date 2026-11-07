import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { AgentId, GrimoireSettings, Preset } from '@grimoire/contract';
import { Chats } from '@ui/app/core/chats';
import { PresetList } from '@ui/app/core/preset-list';
import { Presets } from '@ui/app/core/presets';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';
import { Accounts } from './accounts';
import { ThemeEditor } from './theme-editor';

/**
 * The Colophon: how the book is made. Its settings are written out as
 * words to pick, the picked one underlined, and each is kept by the
 * service as soon as it's picked; among them, the account the agent signs
 * in as. Below them, the presets, each with the first entry its chapters
 * begin with, to rename or remove; then the theme.
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
  private readonly injector = inject(Injector);
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');
  private readonly accountField = viewChild<ElementRef<HTMLInputElement>>('accountField');

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

  constructor() {
    void this.presets.load();
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
