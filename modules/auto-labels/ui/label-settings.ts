import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { GrimoireSettings } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Settings } from '@ui/app/core/settings';

type LabelSetting = 'autoTitles' | 'autoTags' | 'autoSummaries';

/**
 * When chats are named, tagged and summed up on the model for quick tasks,
 * each off until you turn it on, since each spends tokens. Tags come from
 * your tag list, shown here, which the agent can suggest from your chats' titles.
 */
@Component({
  selector: 'gr-label-settings',
  templateUrl: './label-settings.html',
  styleUrl: './label-settings.css',
})
export class LabelSettings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly catalog = inject(AgentCatalog);
  protected readonly settings = inject(Settings);

  protected readonly rows: { key: LabelSetting; label: string; note: string }[] = [
    {
      key: 'autoTitles',
      label: 'Name chats',
      note: 'A title naming what the chat is about; never over one you gave after it.',
    },
    {
      key: 'autoTags',
      label: 'Tag chats',
      note: 'Tags from your tag list, kept in the History; a tag you take off stays off.',
    },
    {
      key: 'autoSummaries',
      label: 'Sum up chats',
      note: 'A line on what the chat is about, under its title in the History.',
    },
  ];

  /** Whether any agent can do quick jobs; without one there's nothing to set. */
  protected readonly able = computed(() =>
    this.catalog.agents().some((agent) => agent.capabilities.includes('ask')),
  );
  /** Your tag list, as the History keeps it. */
  protected readonly tagList = signal<readonly string[]>([]);
  /** Tags the agent suggested, until you add them or ask again. */
  private readonly suggested = signal<readonly string[] | null>(null);
  /** The suggested tags not on your list yet. */
  protected readonly fresh = computed(() => {
    const listed = new Set(this.tagList().map((tag) => tag.toLowerCase()));
    return this.suggested()?.filter((tag) => !listed.has(tag.toLowerCase())) ?? null;
  });
  protected readonly suggesting = signal(false);
  protected readonly failed = signal<string | null>(null);

  constructor() {
    const stop = this.bridge.on('history.tagListChanged', ({ tags }) => this.tagList.set(tags));
    inject(DestroyRef).onDestroy(stop);
    void this.attempt(async () => {
      this.tagList.set((await this.bridge.invoke('history.tagList', {})) ?? []);
    });
  }

  protected isOn(key: LabelSetting): boolean {
    return this.settings.all()[key];
  }

  protected set(key: LabelSetting, on: boolean): void {
    void this.settings.set({ [key]: on } as Partial<GrimoireSettings>);
  }

  protected suggest(): Promise<void> {
    this.suggesting.set(true);
    return this.attempt(async () => {
      this.suggested.set((await this.bridge.invoke('labels.suggestTags', {})) ?? []);
    }).finally(() => this.suggesting.set(false));
  }

  /** Adds suggested tags to the end of your tag list. */
  protected keep(tags: readonly string[]): Promise<void> {
    return this.attempt(async () => {
      const list = (await this.bridge.invoke('history.tagList', {})) ?? [];
      await this.bridge.invoke('history.setTagList', { tags: [...list, ...tags] });
    });
  }

  private async attempt(run: () => Promise<void>): Promise<void> {
    this.failed.set(null);
    try {
      await run();
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }
}
