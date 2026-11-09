import { Component, inject, signal } from '@angular/core';
import type { ScheduleDraft, ScheduleInfo, ScheduleRun } from '@grimoire/contract';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { effortName } from '@ui/app/core/efforts';
import { ScheduleForm } from './schedule-form';
import { ScheduledChats } from './scheduled-chats';
import { cadence, dateline, when } from './wording';

/**
 * Scheduled chats: each schedule a dated journal entry, headed with the
 * day it runs next, with the message its runs begin with and how its last
 * runs went. A schedule is written out in place, to add or change it.
 */
@Component({
  selector: 'gr-schedules-page',
  imports: [ScheduleForm],
  templateUrl: './schedules-page.html',
  styleUrl: './schedules-page.css',
})
export class SchedulesPage {
  protected readonly scheduled = inject(ScheduledChats);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  /** The schedule written out to change, or 'new' for one being added. */
  protected readonly editing = signal<string | null>(null);
  /** The schedule asked about before it's removed. */
  protected readonly removing = signal<string | null>(null);
  /** The schedule running now, until its chat has begun. */
  protected readonly running = signal<string | null>(null);

  protected readonly cadence = cadence;
  protected readonly dateline = dateline;
  protected readonly when = when;

  constructor() {
    void this.scheduled.load();
  }

  /** "Claude Code · ~/git/grimoire · Opus 5.5, Extra high effort". */
  protected settingsOf(schedule: ScheduleInfo): string {
    const { agent, settings } = schedule;
    const model = this.chats.modelLabel(agent, settings, false);
    const { levels, level } = this.chats.effortOf(agent, settings);
    // Auto picks the effort with the model, as each chat begins.
    const effort =
      levels.length && !settings.autoModel ? `, ${effortName(level).toLowerCase()}` : '';
    return `${this.chats.agentName(agent)} · ${model}${effort}`;
  }

  protected outcome(run: ScheduleRun): string {
    if (run.outcome === 'began') return 'Began';
    if (run.outcome === 'missed') return 'Missed: the service wasn’t running in time';
    if (run.outcome === 'skipped') {
      return this.wording.say(
        'Skipped: another volume was open',
        'Skipped: another profile was in use',
      );
    }
    return `Couldn’t begin: ${run.error ?? 'no reason given'}`;
  }

  protected async run(schedule: ScheduleInfo): Promise<void> {
    if (this.running()) return;
    this.running.set(schedule.id);
    try {
      await this.scheduled.run(schedule.id);
    } finally {
      this.running.set(null);
    }
  }

  protected pause(schedule: ScheduleInfo, enabled: boolean): void {
    void this.scheduled.save({ ...draftOf(schedule), enabled });
  }

  protected async remove(schedule: ScheduleInfo): Promise<void> {
    this.removing.set(null);
    await this.scheduled.remove(schedule.id);
  }
}

function draftOf({ nextAt: _, runs: __, ...schedule }: ScheduleInfo): ScheduleDraft {
  return schedule;
}
