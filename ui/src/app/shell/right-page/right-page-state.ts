import { Injectable, computed, signal } from '@angular/core';

/** What the command palette lists, and the chat whose commands they are. */
export interface CommandSearch {
  /** The chat the commands run in. */
  chatId: string;
  /** What's searched for. */
  query: string;
  /**
   * Searched for from the chat's message field, after a "/": the field keeps
   * the keys, and what follows the "/" is what's searched for.
   */
  typed: boolean;
}

/**
 * Turns the right page to the waiting approvals, to the command palette, or
 * to a page tab's page, and back. While it's turned to the approvals, each chat shows its approval as
 * a stub that points to it.
 */
@Injectable({ providedIn: 'root' })
export class RightPageState {
  /** Whether the right page shows the waiting approvals. */
  readonly approvals = signal(false);
  /** The approval card to start on; the oldest when unset. */
  readonly firstApproval = signal<string | undefined>(undefined);
  /**
   * What the command palette searches for while it shows; null when it
   * doesn't. It shows on the page facing its chat, the left page for the
   * chat on the right.
   */
  readonly commandPalette = signal<CommandSearch | null>(null);
  /** Which of its own pages the right page shows, by ID; the first that can be picked when unset. */
  readonly page = signal<string | undefined>(undefined);
  /** The page tab whose page the right page shows; null when it shows none. */
  readonly pageTab = signal<string | null>(null);
  /** Whether the right page is turned away from its own pages. */
  readonly turned = computed(
    () => this.approvals() || this.commandPalette() !== null || this.pageTab() !== null,
  );

  /** Asked before the right page turns away from a page tab's page; false keeps it there. */
  private leaving: (() => boolean) | null = null;

  /**
   * Lets a page tab's page keep the right page from turning away, such
   * as while it holds changes you haven't saved; the guard says why
   * itself. Returns a function that takes the guard away.
   */
  guardLeaving(guard: () => boolean): () => void {
    this.leaving = guard;
    return () => {
      if (this.leaving === guard) this.leaving = null;
    };
  }

  /** Whether the right page may turn away from the page tab's page it shows, if any. */
  private mayLeave(): boolean {
    return this.pageTab() === null || !this.leaving || this.leaving();
  }

  openApprovals(approvalId?: string): void {
    if (!this.mayLeave()) return;
    this.commandPalette.set(null);
    this.pageTab.set(null);
    this.firstApproval.set(approvalId);
    this.approvals.set(true);
  }

  openCommandPalette(search: CommandSearch): void {
    if (!this.mayLeave()) return;
    this.approvals.set(false);
    this.pageTab.set(null);
    this.commandPalette.set(search);
  }

  /** Turns the right page back to its own pages, at this one. */
  showPage(id: string): void {
    if (!this.mayLeave()) return;
    this.approvals.set(false);
    this.commandPalette.set(null);
    this.pageTab.set(null);
    this.page.set(id);
  }

  openPageTab(id: string): void {
    if (this.pageTab() !== id && !this.mayLeave()) return;
    this.approvals.set(false);
    this.commandPalette.set(null);
    this.pageTab.set(id);
  }

  closePageTab(): void {
    if (!this.mayLeave()) return;
    this.pageTab.set(null);
  }

  closeCommandPalette(): void {
    this.commandPalette.set(null);
  }

  closeApprovals(): void {
    this.approvals.set(false);
  }
}
