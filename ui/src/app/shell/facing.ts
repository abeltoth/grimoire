import { Injectable, signal } from '@angular/core';

/**
 * Turns the facing page to the slips awaiting your seal, and back. While
 * it's turned there, each chapter shows its slip as a stub that points to it.
 */
@Injectable({ providedIn: 'root' })
export class Facing {
  /** Whether the facing page shows the slips awaiting your seal. */
  readonly seals = signal(false);
  /** The slip to start on; the oldest when unset. */
  readonly sealFirst = signal<string | undefined>(undefined);

  openSeals(approvalId?: string): void {
    this.sealFirst.set(approvalId);
    this.seals.set(true);
  }

  closeSeals(): void {
    this.seals.set(false);
  }
}
