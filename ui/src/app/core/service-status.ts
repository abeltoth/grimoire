import { Injectable, PendingTasks, inject, signal } from '@angular/core';
import { GRIMOIRE_BRIDGE } from './bridge';

export type ServiceState = 'connecting' | 'connected' | 'failed';

/** Whether the background service answers. Checked once at startup. */
@Injectable({ providedIn: 'root' })
export class ServiceStatus {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pendingTasks = inject(PendingTasks);

  readonly state = signal<ServiceState>('connecting');
  readonly error = signal<string | null>(null);

  check(): void {
    this.state.set('connecting');
    // A pending task keeps the app "unstable" until the answer is in.
    this.pendingTasks.run(async () => {
      try {
        await this.bridge.invoke('core.ping', {});
        this.error.set(null);
        this.state.set('connected');
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : String(error));
        this.state.set('failed');
      }
    });
  }
}
