import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Schedule, ScheduleDraft, ScheduleRun } from '@grimoire/contract';
import { activeProfile } from '../storage/app-state';
import { isTime } from './times';

interface ScheduleRow {
  id: string;
  name: string;
  agent: string;
  settings: string;
  prompt: string;
  days: string;
  time: string;
  enabled: number;
  handled_until: number;
}

interface RunRow {
  schedule_id: string;
  due_at: number;
  outcome: ScheduleRun['outcome'];
  ran_at: number | null;
  chat_id: string | null;
  cwd: string | null;
  error: string | null;
}

const fromRow = (row: ScheduleRow): Schedule => ({
  id: row.id,
  name: row.name,
  agent: row.agent,
  settings: JSON.parse(row.settings) as Schedule['settings'],
  prompt: row.prompt,
  days: JSON.parse(row.days) as number[],
  time: row.time,
  enabled: row.enabled === 1,
});

/**
 * The schedules and the record of their runs, kept in SQLite. Each keeps
 * the last time it was due that has been seen to, so a time is run or
 * counted as missed only once. Each belongs to the profile it was made
 * in; the list is the profile in use's, as `profile` says.
 */
export class ScheduleStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly profile: () => string = () => activeProfile(db),
  ) {}

  list(): Schedule[] {
    const rows = this.db
      .prepare('SELECT * FROM schedules WHERE profile = ? ORDER BY position')
      .all(this.profile()) as unknown as ScheduleRow[];
    return rows.map(fromRow);
  }

  /** Every profile's schedules, the one in use's and the others'. */
  all(): Schedule[] {
    const rows = this.db
      .prepare('SELECT * FROM schedules ORDER BY position')
      .all() as unknown as ScheduleRow[];
    return rows.map(fromRow);
  }

  /** Whether the schedule is the profile in use's. */
  inUse(id: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM schedules WHERE id = ? AND profile = ?')
      .get(id, this.profile());
  }

  get(id: string): Schedule | undefined {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row && fromRow(row);
  }

  /**
   * Saves a schedule, a new one when it has no ID, and returns it. Its
   * times are seen to up to `now`: a time it was due before you saved it,
   * or while it was paused, doesn't run or count as missed.
   */
  save(draft: ScheduleDraft, now: number): Schedule {
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    if (!name) throw new Error('A schedule needs a name');
    if (!prompt) throw new Error('A schedule needs a first message');
    if (!isTime(draft.time)) throw new Error(`"${draft.time}" isn't a time such as 08:00`);
    const days = [...new Set(draft.days)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    const schedule: Schedule = { ...draft, id: draft.id ?? randomUUID(), name, prompt, days };
    this.db
      .prepare(
        `INSERT INTO schedules (id, name, agent, settings, prompt, days, time, enabled, handled_until, profile, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM schedules))
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, agent = excluded.agent, settings = excluded.settings,
           prompt = excluded.prompt, days = excluded.days, time = excluded.time,
           enabled = excluded.enabled, handled_until = excluded.handled_until`,
      )
      .run(
        schedule.id,
        name,
        schedule.agent,
        JSON.stringify(schedule.settings),
        prompt,
        JSON.stringify(days),
        schedule.time,
        schedule.enabled ? 1 : 0,
        now,
        this.profile(),
      );
    return schedule;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM schedule_runs WHERE schedule_id = ?').run(id);
  }

  /** The last time the schedule was due that has been run or counted as missed. */
  handledUntil(id: string): number {
    const row = this.db.prepare('SELECT handled_until FROM schedules WHERE id = ?').get(id) as
      | { handled_until: number }
      | undefined;
    return row?.handled_until ?? 0;
  }

  setHandledUntil(id: string, at: number): void {
    this.db.prepare('UPDATE schedules SET handled_until = ? WHERE id = ?').run(at, id);
  }

  addRun(run: ScheduleRun): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO schedule_runs (schedule_id, due_at, outcome, ran_at, chat_id, cwd, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(run.scheduleId, run.dueAt, run.outcome, run.ranAt ?? null, run.chatId ?? null, run.cwd ?? null, run.error ?? null);
  }

  /** The schedule's last runs, newest first. */
  runs(id: string, limit: number): ScheduleRun[] {
    const rows = this.db
      .prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY due_at DESC LIMIT ?')
      .all(id, limit) as unknown as RunRow[];
    return rows.map((row) => ({
      scheduleId: row.schedule_id,
      dueAt: row.due_at,
      outcome: row.outcome,
      ...(row.ran_at !== null ? { ranAt: row.ran_at } : {}),
      ...(row.chat_id !== null ? { chatId: row.chat_id } : {}),
      ...(row.cwd !== null ? { cwd: row.cwd } : {}),
      ...(row.error !== null ? { error: row.error } : {}),
    }));
  }
}
