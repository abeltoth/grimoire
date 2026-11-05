import { Injectable, effect, inject, signal } from '@angular/core';
import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { DesignSettings } from '../../design-system/design-settings';
import { GRIMOIRE_BRIDGE } from './bridge';

/**
 * Grimoire's settings, as the service keeps them (ADR-007): set on the
 * Colophon, and the same in every window.
 */
@Injectable({ providedIn: 'root' })
export class Settings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly all = signal<GrimoireSettings>(DEFAULT_SETTINGS);
  /** Why the last change couldn't be kept. */
  readonly failed = signal<string | null>(null);
  /** Settles once the service's settings have been asked for, whatever it answered. */
  readonly ready: Promise<void>;

  constructor() {
    this.bridge.on('settings.changed', ({ settings }) => this.all.set(settings));
    this.ready = this.bridge.invoke('settings.get', {}).then(
      (settings) => {
        if (settings) this.all.set(settings);
      },
      () => {},
    );
    const design = inject(DesignSettings);
    effect(() => design.drawings.set(this.all().drawings));
  }

  /** Changes the settings given at once, and back again if the service refuses them. */
  async set(change: Partial<GrimoireSettings>): Promise<void> {
    const before = this.all();
    this.all.set({ ...before, ...change });
    try {
      const settings = await this.bridge.invoke('settings.set', change);
      if (settings) this.all.set(settings);
      this.failed.set(null);
    } catch (error) {
      this.all.set(before);
      this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }
}
