import { Injectable, computed, signal } from '@angular/core';
import type { AgentCommand, AgentId } from '@grimoire/contract';

/** What you're looking up among an agent's commands, from the start of an entry. */
export interface CommandLookUp {
  chapterId: string;
  agent: AgentId;
  /** The chapter's folder; the agent's commands can differ between folders. */
  cwd?: string;
  /** What follows the "/" so far. */
  query: string;
  /** Writes the command in the entry and sends it. */
  use(command: AgentCommand): void;
}

/**
 * Turns the facing page to the slips awaiting your seal, to the Index, to
 * an agent's commands, or to a thumb tab's page, and back. While it's turned to the slips, each chapter shows its slip as
 * a stub that points to it.
 */
@Injectable({ providedIn: 'root' })
export class Facing {
  /** Whether the facing page shows the slips awaiting your seal. */
  readonly seals = signal(false);
  /** The slip to start on; the oldest when unset. */
  readonly sealFirst = signal<string | undefined>(undefined);
  /** What the Index looks up while the facing page shows it; null when it doesn't. */
  readonly index = signal<string | null>(null);
  /** The agent's commands the facing page lists; null when it doesn't. */
  readonly commands = signal<CommandLookUp | null>(null);
  /** Which of its own pages the facing page shows, by ID; the first that can be picked when unset. */
  readonly page = signal<string | undefined>(undefined);
  /** The thumb tab whose page the facing page shows; null when it shows none. */
  readonly thumb = signal<string | null>(null);
  /** Whether the facing page is turned away from its own pages. */
  readonly turned = computed(
    () =>
      this.seals() || this.index() !== null || this.commands() !== null || this.thumb() !== null,
  );

  /** Asked before the facing page turns away from a thumb tab's page; false keeps it there. */
  private leaving: (() => boolean) | null = null;

  /**
   * Lets a thumb tab's page keep the facing page from turning away, such
   * as while it holds changes you haven't saved; the guard says why
   * itself. Returns a function that takes the guard away.
   */
  guardLeaving(guard: () => boolean): () => void {
    this.leaving = guard;
    return () => {
      if (this.leaving === guard) this.leaving = null;
    };
  }

  /** Whether the facing page may turn away from the thumb tab's page it shows, if any. */
  private mayLeave(): boolean {
    return this.thumb() === null || !this.leaving || this.leaving();
  }

  openSeals(approvalId?: string): void {
    if (!this.mayLeave()) return;
    this.index.set(null);
    this.commands.set(null);
    this.thumb.set(null);
    this.sealFirst.set(approvalId);
    this.seals.set(true);
  }

  openIndex(lookUp = ''): void {
    if (!this.mayLeave()) return;
    this.seals.set(false);
    this.commands.set(null);
    this.thumb.set(null);
    this.index.set(lookUp);
  }

  openCommands(lookUp: CommandLookUp): void {
    if (!this.mayLeave()) return;
    this.seals.set(false);
    this.index.set(null);
    this.thumb.set(null);
    this.commands.set(lookUp);
  }

  /** Turns the facing page back to its own pages, at this one. */
  showPage(id: string): void {
    if (!this.mayLeave()) return;
    this.seals.set(false);
    this.index.set(null);
    this.commands.set(null);
    this.thumb.set(null);
    this.page.set(id);
  }

  openThumb(id: string): void {
    if (this.thumb() !== id && !this.mayLeave()) return;
    this.seals.set(false);
    this.index.set(null);
    this.commands.set(null);
    this.thumb.set(id);
  }

  closeThumb(): void {
    if (!this.mayLeave()) return;
    this.thumb.set(null);
  }

  closeCommands(): void {
    this.commands.set(null);
  }

  closeIndex(): void {
    this.index.set(null);
  }

  closeSeals(): void {
    this.seals.set(false);
  }
}
