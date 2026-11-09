import { Injectable, effect, inject, signal } from '@angular/core';
import { DEFAULT_SETTINGS, type GrimoireSettings } from '@grimoire/contract';
import { DesignSettings } from '../../design-system/design-settings';
import { GRIMOIRE_BRIDGE } from './bridge';

/** How long a run of changes, such as dragging a colour, waits to be kept once it stops. */
const SOON_MS = 300;

/**
 * Grimoire's settings, as the service keeps them (ADR-007): set in
 * Settings, and the same in every window.
 */
@Injectable({ providedIn: 'root' })
export class Settings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly all = signal<GrimoireSettings>(DEFAULT_SETTINGS);
  /** Why the last change couldn't be kept. */
  readonly failed = signal<string | null>(null);
  /** Settles once the service's settings have been asked for, whatever it answered. */
  readonly ready: Promise<void>;
  /** Changes made here but not yet sent, which stand over what the service says until they are. */
  private pending: Partial<GrimoireSettings> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.bridge.on('settings.changed', ({ settings }) => this.take(settings));
    this.ready = this.reload();
    const design = inject(DesignSettings);
    effect(() => {
      const { drawings, theme, themeName } = this.all();
      design.drawings.set(drawings);
      design.themeName.set(themeName ?? 'grimoire');
      design.tokens.set(theme ?? {});
    });
  }

  /** Changes the settings given at once, and as the service has them again if it refuses them. */
  async set(change: Partial<GrimoireSettings>): Promise<void> {
    // A change still waiting to be sent would undo this one once it is.
    for (const key of Object.keys(change)) delete this.pending[key as keyof GrimoireSettings];
    this.all.update((all) => ({ ...all, ...change }));
    await this.send(change);
  }

  /**
   * Changes the settings given at once, and sends them once they've stopped
   * changing for a moment, so a colour being dragged is kept once, not at every step.
   */
  setSoon(change: Partial<GrimoireSettings>): void {
    this.pending = { ...this.pending, ...change };
    this.all.update((all) => ({ ...all, ...change }));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const pending = this.pending;
      this.pending = {};
      void this.send(pending);
    }, SOON_MS);
  }

  private async send(change: Partial<GrimoireSettings>): Promise<void> {
    try {
      const settings = await this.bridge.invoke('settings.set', change);
      if (settings) this.take(settings);
      this.failed.set(null);
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
      await this.reload();
    }
  }

  private async reload(): Promise<void> {
    try {
      const settings = await this.bridge.invoke('settings.get', {});
      if (settings) this.take(settings);
    } catch {
      // Keep the settings shown.
    }
  }

  private take(settings: GrimoireSettings): void {
    this.all.set({ ...settings, ...this.pending });
  }
}
