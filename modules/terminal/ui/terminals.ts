import { Injectable, computed, inject, signal } from '@angular/core';
import type { TerminalInfo } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { tabLabels } from './tab-labels';

/**
 * The shells the Terminal shows as tabs. They run in the background
 * service (ADR-010), so this only mirrors them: it reads them again each
 * time the page opens.
 */
@Injectable({ providedIn: 'root' })
export class Terminals {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);

  readonly terminals = signal<readonly TerminalInfo[]>([]);
  readonly labels = computed(() => tabLabels(this.terminals(), this.chats.folders().home));
  /** The tab shown; the newest when unset. */
  private readonly shownId = signal<string | undefined>(undefined);
  readonly shown = computed(() => {
    const terminals = this.terminals();
    return terminals.find(({ id }) => id === this.shownId()) ?? terminals.at(-1);
  });
  /** Whether the service has said which shells run. */
  readonly read = signal(false);
  readonly failed = signal<string | null>(null);
  /** The size the shown terminal fits, so a new one starts at it. */
  readonly size = signal({ cols: 80, rows: 24 });
  /** The open chat's folder, where a new terminal starts; your home folder without one. */
  readonly cwd = computed(() => this.chats.current()?.settings.cwd ?? this.chats.folders().home);

  constructor() {
    this.bridge.on('terminal.exited', ({ id }) => this.forget(id));
  }

  /** Reads which shells run; starts one in the chat's folder when none does. */
  async load(): Promise<void> {
    this.failed.set(null);
    try {
      this.terminals.set(await this.bridge.invoke('terminal.list', {}));
      this.read.set(true);
      if (!this.terminals().length) await this.open();
    } catch (error) {
      this.fail(error);
    }
  }

  /** Starts a shell in the open chat's folder, on a tab of its own. */
  async open(): Promise<void> {
    try {
      const terminal = await this.bridge.invoke('terminal.open', { cwd: this.cwd(), ...this.size() });
      this.terminals.update((terminals) => [...terminals, terminal]);
      this.shownId.set(terminal.id);
    } catch (error) {
      this.fail(error);
    }
  }

  show(id: string): void {
    this.shownId.set(id);
  }

  /** Ends the shell, and whatever it's running. */
  async close(id: string): Promise<void> {
    this.forget(id);
    await this.bridge.invoke('terminal.close', { id }).catch(() => {});
  }

  /** Drops the tab, showing the one after it, or the one before when it was the last. */
  private forget(id: string): void {
    const terminals = this.terminals();
    const at = terminals.findIndex((terminal) => terminal.id === id);
    if (at === -1) return;
    const left = terminals.filter((terminal) => terminal.id !== id);
    if (this.shown()?.id === id) this.shownId.set(left[Math.min(at, left.length - 1)]?.id);
    this.terminals.set(left);
  }

  private fail(error: unknown): void {
    this.failed.set(error instanceof Error ? error.message : String(error));
  }
}
