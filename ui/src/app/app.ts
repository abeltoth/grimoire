import { Component, PendingTasks, inject, signal } from '@angular/core';
import type { PingResult } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './core/bridge';

type ServiceStatus =
  | { state: 'connecting' }
  | { state: 'connected'; ping: PingResult }
  | { state: 'failed'; message: string };

/**
 * Phase 1 placeholder: a title strip with window controls, and the
 * background service's ping. The book shell replaces it in phase 3.
 */
@Component({
  selector: 'gr-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pendingTasks = inject(PendingTasks);

  protected readonly platform = this.bridge.platform;
  protected readonly status = signal<ServiceStatus>({ state: 'connecting' });

  constructor() {
    this.ping();
  }

  protected ping(): void {
    this.status.set({ state: 'connecting' });
    // A pending task keeps the app "unstable" until the answer is shown.
    this.pendingTasks.run(async () => {
      try {
        const ping = await this.bridge.invoke('core.ping', {});
        this.status.set({ state: 'connected', ping });
      } catch (error) {
        this.status.set({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  protected minimize(): void {
    this.bridge.window.minimize();
  }

  protected toggleMaximize(): void {
    this.bridge.window.toggleMaximize();
  }

  protected close(): void {
    this.bridge.window.close();
  }

  protected uptime(ping: PingResult): string {
    const seconds = Math.round(ping.uptimeMs / 1000);
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }
}
