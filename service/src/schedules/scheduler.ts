import type {
  AgentId,
  EventName,
  EventPayload,
  NewChatSettings,
  OpenChat,
  Schedule,
  ScheduleDraft,
  ScheduleInfo,
  ScheduleRun,
} from '@grimoire/contract';
import type { ScheduleStore } from './store';
import { dueTimes, nextDue } from './times';

/** How late a run may still begin, when the service wasn't running at its time. */
export const CATCH_UP_MS = 3 * 60 * 60_000;
/** How far back missed runs are counted, after the service was away for long. */
const LOOK_BACK_MS = 7 * 24 * 60 * 60_000;
/** How many of each schedule's last runs are shown. */
const RUNS_SHOWN = 5;

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** Begins a new chat with its first entry, under the title given, as the agent hub does. */
export type BeginChat = (
  agent: AgentId,
  settings: NewChatSettings,
  text: string,
  title: string,
) => Promise<OpenChat>;

/** A run's chat title: the schedule's name and the day it was due, "Morning repo summary · 4 Nov". */
export function runTitle(name: string, dueAt: number): string {
  return `${name} · ${new Date(dueAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

/**
 * Runs the schedules while the service runs: each time one is due it
 * begins a new chat, with Full access, as no one is there to approve
 * what it does. A time that passed while the service wasn't
 * running begins once it's back, unless that is more than CATCH_UP_MS
 * late; then, like any earlier time it was away for, it counts as missed.
 * A schedule of a profile not in use doesn't run: its time is skipped.
 */
export class Scheduler {
  private checking: Promise<void> | undefined;

  constructor(
    private readonly store: ScheduleStore,
    private readonly begin: BeginChat,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {}

  list(): ScheduleInfo[] {
    const now = this.now();
    return this.store.list().map((schedule) => ({
      ...schedule,
      nextAt: schedule.enabled ? nextDue(schedule, now) : null,
      runs: this.store.runs(schedule.id, RUNS_SHOWN),
    }));
  }

  save(draft: ScheduleDraft): ScheduleInfo[] {
    this.store.save(draft, this.now());
    return this.changed();
  }

  remove(id: string): ScheduleInfo[] {
    this.store.remove(id);
    return this.changed();
  }

  /** Runs a schedule now, whatever its days. */
  async run(id: string): Promise<ScheduleRun> {
    const schedule = this.store.get(id);
    if (!schedule) throw new Error('There is no such schedule');
    const run = await this.start(schedule, this.now());
    this.changed();
    return run;
  }

  /** Begins what is due, once at a time; a check asked for while one runs waits for it. */
  check(): Promise<void> {
    this.checking ??= this.dueNow().finally(() => (this.checking = undefined));
    return this.checking;
  }

  /** Checks now and every `ms`, which also notices a time passed while the computer slept. */
  checkEvery(ms: number): () => void {
    void this.check();
    const timer = setInterval(() => void this.check(), ms);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async dueNow(): Promise<void> {
    let changed = false;
    // Every profile's: one not in use counts its time skipped, so it doesn't run when it's back.
    for (const schedule of this.store.all()) {
      if (!schedule.enabled) continue;
      const now = this.now();
      const due = dueTimes(schedule, this.store.handledUntil(schedule.id), now, LOOK_BACK_MS);
      const last = due.pop();
      if (last === undefined) continue;
      // Seen to first, so a run that fails to begin isn't tried again and again.
      this.store.setHandledUntil(schedule.id, last);
      changed = true;
      for (const dueAt of due) this.store.addRun({ scheduleId: schedule.id, dueAt, outcome: 'missed' });
      if (now - last > CATCH_UP_MS) {
        this.store.addRun({ scheduleId: schedule.id, dueAt: last, outcome: 'missed' });
      } else if (!this.store.inUse(schedule.id)) {
        this.store.addRun({ scheduleId: schedule.id, dueAt: last, outcome: 'skipped' });
      } else {
        await this.start(schedule, last);
      }
    }
    if (changed) this.changed();
  }

  private async start(schedule: Schedule, dueAt: number): Promise<ScheduleRun> {
    let run: ScheduleRun;
    try {
      const chat = await this.begin(
        schedule.agent,
        { ...schedule.settings, mode: 'allow-all' },
        schedule.prompt,
        runTitle(schedule.name, dueAt),
      );
      run = {
        scheduleId: schedule.id,
        dueAt,
        outcome: 'began',
        ranAt: this.now(),
        chatId: chat.id,
        cwd: chat.settings.cwd,
      };
      this.store.addRun(run);
      this.emit('schedules.began', { run, chat });
    } catch (error) {
      run = {
        scheduleId: schedule.id,
        dueAt,
        outcome: 'failed',
        ranAt: this.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      this.store.addRun(run);
    }
    return run;
  }

  private changed(): ScheduleInfo[] {
    const schedules = this.list();
    this.emit('schedules.changed', { schedules });
    return schedules;
  }
}
