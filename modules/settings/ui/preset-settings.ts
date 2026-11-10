import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { Preset } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { PresetList } from '@ui/app/core/preset-list';
import { Presets } from '@ui/app/core/presets';
import { Wording } from '@ui/app/core/wording';

/**
 * The Settings page's presets, each with the first message its chats
 * begin with, to rename or remove.
 */
@Component({
  selector: 'gr-preset-settings',
  templateUrl: './preset-settings.html',
  styleUrls: ['./preset-settings.css', './settings-sections.css'],
})
export class PresetSettings {
  protected readonly catalog = inject(AgentCatalog);
  protected readonly presets = inject(PresetList);
  protected readonly described = inject(Presets);
  protected readonly wording = inject(Wording);
  private readonly injector = inject(Injector);
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  /** The preset being renamed, by name. */
  protected readonly renaming = signal<string | null>(null);
  /** The preset asked about before it's removed. */
  protected readonly removing = signal<string | null>(null);

  constructor() {
    void this.presets.load();
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

  protected setPrompt(preset: Preset, prompt: string): void {
    if (prompt.trim() !== (preset.prompt ?? '')) void this.presets.setPrompt(preset, prompt);
  }
}
