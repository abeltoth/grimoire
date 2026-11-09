import type { DatabaseSync } from 'node:sqlite';
import type { AgentHub } from './agents/hub';
import type { ClaudeAdapter } from './agents/claude/claude-adapter';
import type { ProfileStore } from './core/profiles';
import type { SettingsStore } from './core/settings';
import type { ServiceEvents } from './events';
import type { CommandRegistry } from './registry';
import { migrate } from './storage/database';

/** A feature's backend part (ADR-008); service/src/modules.ts lists them all. */
export interface ServiceModule {
  /** Its folder's name, under which its tables' version is kept. */
  readonly id: string;
  /** Its tables' migrations, each moving them up one version: append new ones; never edit old ones. */
  readonly migrations?: readonly string[];
  /** Registers its commands and starts what it runs. */
  start(context: ModuleContext): ModuleHooks | void;
}

/** What a running module does as the service goes on. */
export interface ModuleHooks {
  /** The service listens: timers and warm-ups start. */
  ready?(): void;
  /** Another profile is in use: what runs in the background starts again in it, and windows hear its state. */
  profileSwitched?(): void;
  /** A profile is deleted, inside the deletion's transaction: what the module kept of it goes too. */
  profileRemoved?(id: string): void;
  /** The service stops. */
  stop?(): void;
}

/**
 * The core services a module uses (ADR-008). Modules reach each other only
 * through commands, with `registry.dispatch`, and events.
 */
export interface ModuleContext {
  readonly registry: CommandRegistry;
  readonly db: DatabaseSync;
  readonly events: ServiceEvents;
  readonly log: (message: string) => void;
  /** Where Grimoire keeps its data. */
  readonly dataDir: string;
  /** Grimoire's own data stays in memory, for smoke tests and captures. */
  readonly ephemeral: boolean;
  readonly settings: SettingsStore;
  readonly profiles: ProfileStore;
  readonly hub: AgentHub;
  readonly claude: ClaudeAdapter;
}

/** The modules running, each started with its tables migrated. */
export class Modules {
  private readonly running: ModuleHooks[] = [];

  constructor(private readonly list: readonly ServiceModule[]) {}

  start(context: ModuleContext): void {
    for (const module of this.list) {
      migrate(context.db, module.id, module.migrations ?? []);
      const hooks = module.start(context);
      if (hooks) this.running.push(hooks);
    }
  }

  ready(): void {
    for (const hooks of this.running) hooks.ready?.();
  }

  profileSwitched(): void {
    for (const hooks of this.running) hooks.profileSwitched?.();
  }

  profileRemoved(id: string): void {
    for (const hooks of this.running) hooks.profileRemoved?.(id);
  }

  stop(): void {
    for (const hooks of this.running) hooks.stop?.();
  }
}
