import { Component, computed, inject } from '@angular/core';
import type { AgentId, GrimoireSettings } from '@grimoire/contract';
import { Chats } from '@ui/app/core/chats';
import { PresetList } from '@ui/app/core/preset-list';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';

/**
 * The Colophon: how the book is made. Its settings are written out as
 * words to pick, the picked one underlined, and each is kept by the
 * service as soon as it's picked.
 */
@Component({
  selector: 'gr-colophon-page',
  templateUrl: './colophon-page.html',
  styleUrl: './colophon-page.css',
})
export class ColophonPage {
  protected readonly settings = inject(Settings);
  protected readonly chats = inject(Chats);
  protected readonly presets = inject(PresetList);
  protected readonly wording = inject(Wording);

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
}
