import { Injectable, inject, signal } from '@angular/core';
import type { Preset } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/** The saved presets, as the service keeps them (Grimoire's own data). */
@Injectable({ providedIn: 'root' })
export class PresetList {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly all = signal<readonly Preset[]>([]);
  /** Why the last change to a preset couldn't be made. */
  readonly failed = signal<string | null>(null);
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

  /** Gives a preset another name; says whether it took it. */
  rename(from: string, to: string): Promise<boolean> {
    return this.change(this.bridge.invoke('presets.rename', { from, to }));
  }

  remove(name: string): Promise<boolean> {
    return this.change(this.bridge.invoke('presets.remove', { name }));
  }

  /** Writes in the first message chats begun with the preset have; "" for none. */
  setPrompt(preset: Preset, prompt: string): Promise<boolean> {
    return this.change(this.bridge.invoke('presets.save', { ...preset, prompt }));
  }

  private async change(changed: Promise<Preset[]>): Promise<boolean> {
    try {
      const presets = await changed;
      if (presets) this.all.set(presets);
      this.failed.set(null);
      return true;
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}
