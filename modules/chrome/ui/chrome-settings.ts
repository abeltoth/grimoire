import { Component, computed, inject, signal } from '@angular/core';
import type { ChromeState } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Wording } from '@ui/app/core/wording';

/**
 * Whether Claude Code's chats may use your Chrome, where you're signed in,
 * with the extension's state beside it and a link to install it when it
 * isn't. The switch is Claude Code's own /chrome "Enabled by default".
 */
@Component({
  selector: 'gr-chrome-settings',
  templateUrl: './chrome-settings.html',
  styleUrl: './chrome-settings.css',
})
export class ChromeSettings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);

  /** Only Claude Code has Claude in Chrome. */
  protected readonly able = computed(() =>
    this.catalog.agents().some((agent) => agent.id === 'claude-code'),
  );
  /** Its state; undefined while it's asked, null when Claude Code couldn't say. */
  protected readonly state = signal<ChromeState | null | undefined>(undefined);
  /** The switch, as last picked, while its state is asked again. */
  protected readonly picked = signal<boolean | null>(null);
  protected readonly failed = signal<string | null>(null);

  protected readonly on = computed(() => this.picked() ?? this.state()?.on ?? false);

  constructor() {
    void this.attempt(async () => this.state.set(await this.bridge.invoke('chrome.get', {})));
  }

  protected async set(on: boolean): Promise<void> {
    if (on === this.on()) return;
    this.picked.set(on);
    await this.attempt(async () => this.state.set(await this.bridge.invoke('chrome.set', { on })));
    this.picked.set(null);
  }

  protected open(url: string): void {
    this.bridge.openExternal(url);
  }

  private async attempt(run: () => Promise<void>): Promise<void> {
    this.failed.set(null);
    try {
      await run();
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
      this.state.update((state) => state ?? null);
    }
  }
}
