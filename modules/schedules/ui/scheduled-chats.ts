import { Injectable, computed, inject, signal } from '@angular/core';
import type { ScheduleDraft, ScheduleInfo, ScheduleRun } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';

/**
 * The schedules, as the window sees them: a mirror of the service's,
 * kept current by its events. A run's chat joins the open chats as it begins.
 */
@Injectable({ providedIn: 'root' })
export class ScheduledChats {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);

  /** Undefined until the service has listed them. */
  readonly all = signal<readonly ScheduleInfo[] | undefined>(undefined);
  /** Why the last change failed, until the next one. */
  readonly failed = signal<string | null>(null);
  /** The schedule that runs next, if any runs. */
  readonly next = computed(() =>
    (this.all() ?? []).reduce<ScheduleInfo | undefined>(
      (next, schedule) =>
        schedule.nextAt !== null && (!next || schedule.nextAt < next.nextAt!) ? schedule : next,
      undefined,
    ),
  );

  constructor() {
    this.bridge.on('schedules.changed', ({ schedules }) => this.all.set(schedules));
    this.bridge.on('schedules.began', ({ chat }) => this.list.adopt(chat));
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const schedules = await this.bridge.invoke('schedules.list', {});
      if (schedules) this.all.set(schedules);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Saves a schedule; false when the service turned it away, and why shows. */
  async save(draft: ScheduleDraft): Promise<boolean> {
    return this.change(() => this.bridge.invoke('schedules.save', draft));
  }

  async remove(id: string): Promise<boolean> {
    return this.change(() => this.bridge.invoke('schedules.remove', { id }));
  }

  /** Runs a schedule now, and turns to the chat it began. */
  async run(id: string): Promise<ScheduleRun | undefined> {
    this.failed.set(null);
    try {
      const run = await this.bridge.invoke('schedules.run', { id });
      if (run?.chatId && this.list.has(run.chatId)) this.list.open(run.chatId);
      if (run?.outcome === 'failed') this.failed.set(run.error ?? 'The run couldn’t begin');
      return run;
    } catch (error) {
      this.fail(error);
      return undefined;
    }
  }

  /** Turns to a run's chat, opening it again when it was closed. */
  async openRun(schedule: ScheduleInfo, run: ScheduleRun): Promise<void> {
    if (!run.chatId) return;
    if (this.list.has(run.chatId)) return this.list.open(run.chatId);
    await this.list.openChat({
      id: run.chatId,
      agent: schedule.agent,
      title: '',
      ...(run.cwd ? { cwd: run.cwd } : {}),
      updatedAt: run.ranAt ?? run.dueAt,
    });
  }

  private async change(request: () => Promise<ScheduleInfo[]>): Promise<boolean> {
    this.failed.set(null);
    try {
      this.all.set(await request());
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown): void {
    this.failed.set(error instanceof Error ? error.message : String(error));
  }
}
