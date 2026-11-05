import { Injectable, inject, signal } from '@angular/core';
import type { Preset } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/** The saved presets, as the service keeps them (ADR-009: Grimoire's own data). */
@Injectable({ providedIn: 'root' })
export class PresetList {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly all = signal<readonly Preset[]>([]);
  /** Settles once the presets have been asked for, whatever the service answered. */
  readonly ready = this.load();

  async load(): Promise<void> {
    try {
      const presets = await this.bridge.invoke('presets.list', {});
      if (presets) this.all.set(presets);
    } catch {
      // Keep the presets listed before.
    }
  }
}
