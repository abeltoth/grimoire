import { Injectable, computed, signal } from '@angular/core';

/**
 * Turns the facing page to the slips awaiting your seal, or to the Index,
 * and back. While it's turned to the slips, each chapter shows its slip as
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
  /** Whether the facing page is turned away from its own pages. */
  readonly turned = computed(() => this.seals() || this.index() !== null);

  openSeals(approvalId?: string): void {
    this.index.set(null);
    this.sealFirst.set(approvalId);
    this.seals.set(true);
  }

  openIndex(lookUp = ''): void {
    this.seals.set(false);
    this.index.set(lookUp);
  }

  closeIndex(): void {
    this.index.set(null);
  }

  closeSeals(): void {
    this.seals.set(false);
  }
}
