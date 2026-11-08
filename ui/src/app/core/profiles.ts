import { Injectable, computed, inject, signal } from '@angular/core';
import type { Profile, Profiles as ProfileList } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';

/** Kept across the window's reload on a switch: sign in once the profile it names is in use. */
const SIGN_IN_NEXT = 'grimoire.signInNext';

/**
 * Your profiles, such as work and personal, and the one in use, as the
 * service keeps them (ADR-009): each with its own Claude folder, settings,
 * presets, schedules and chapters. Switching puts the open chapters away;
 * the window then opens again on the new profile's.
 */
@Injectable({ providedIn: 'root' })
export class Profiles {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly list = signal<ProfileList>({ active: '', profiles: [] });
  /** The profile in use; undefined until the service has said. */
  readonly active = computed(() =>
    this.list().profiles.find((profile) => profile.id === this.list().active),
  );
  /** The profiles not in use, to switch to. */
  readonly others = computed(() =>
    this.list().profiles.filter((profile) => profile.id !== this.list().active),
  );
  /** Why the last profile couldn't be made, renamed or deleted. */
  readonly failed = signal<string | null>(null);
  /** Why the last switch was refused, such as a chapter still being written. */
  readonly refused = signal<string | null>(null);
  /** The profile being switched to, until the service has answered. */
  readonly switching = signal<string | null>(null);
  /** The profile in use was switched to so it could be signed in; the Colophon asks for the account. */
  readonly signInNext = signal(false);

  constructor() {
    this.bridge.on('profiles.changed', ({ profiles }) => this.list.set(profiles));
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const profiles = await this.bridge.invoke('profiles.list', {});
      if (profiles) this.list.set(profiles);
    } catch {
      // Keep the profiles listed before.
    }
    const next = sessionStorage.getItem(SIGN_IN_NEXT);
    if (next) {
      sessionStorage.removeItem(SIGN_IN_NEXT);
      this.signInNext.set(next === this.list().active);
    }
  }

  /** Makes a profile; returns it, or undefined when it couldn't be made. */
  async create(name: string): Promise<Profile | undefined> {
    const before = new Set(this.list().profiles.map((profile) => profile.id));
    const made = await this.change(this.bridge.invoke('profiles.create', { name }));
    return made ? this.list().profiles.find((profile) => !before.has(profile.id)) : undefined;
  }

  rename(id: string, name: string): Promise<boolean> {
    return this.change(this.bridge.invoke('profiles.rename', { id, name }));
  }

  remove(id: string): Promise<boolean> {
    return this.change(this.bridge.invoke('profiles.remove', { id }));
  }

  /** Puts the profile in use; a refusal says why in `refused`. Says whether it switched. */
  async switch(id: string): Promise<boolean> {
    if (this.switching() || id === this.list().active) return false;
    this.switching.set(id);
    this.refused.set(null);
    try {
      const profiles = await this.bridge.invoke('profiles.switch', { id });
      if (profiles) this.list.set(profiles);
      return true;
    } catch (error) {
      this.refused.set(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      this.switching.set(null);
    }
  }

  /** Switches to the profile, and once the window has opened again on it, asks for the account to sign in as. */
  async switchToSignIn(id: string): Promise<void> {
    sessionStorage.setItem(SIGN_IN_NEXT, id);
    if (!(await this.switch(id))) sessionStorage.removeItem(SIGN_IN_NEXT);
  }

  private async change(changed: Promise<ProfileList>): Promise<boolean> {
    try {
      const profiles = await changed;
      if (profiles) this.list.set(profiles);
      this.failed.set(null);
      return true;
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}
