import type { AgentId, ChatId, NewChatSettings, OpenChat } from './agents';

/**
 * A chat Grimoire begins by itself, on the days and at the time set, such
 * as a morning summary of a repository's changes (ADR-009: Grimoire's own
 * data). Each run begins a new chapter, with Full access: no one is
 * there to approve.
 */
export interface Schedule {
  id: string;
  name: string;
  agent: AgentId;
  /** The chapter's settings, but for its permission: always Full access. */
  settings: Omit<NewChatSettings, 'mode'>;
  /** The first entry each run writes. */
  prompt: string;
  /** The days of the week it runs on, 0 for Sunday to 6 for Saturday. */
  days: number[];
  /** The time it runs at on those days, in your local time, as "08:00". */
  time: string;
  /** A paused schedule doesn't run, nor does it count its runs as missed. */
  enabled: boolean;
}

/** A schedule as you write it: a new one has no ID yet. */
export type ScheduleDraft = Omit<Schedule, 'id'> & { id?: string };

/** One time a schedule was due, and what came of it. */
export interface ScheduleRun {
  scheduleId: string;
  /** When it was due, in ms since the epoch; when you asked, for a run you began yourself. */
  dueAt: number;
  /**
   * Began a chapter; missed, because the service wasn't running then and
   * is back too late to catch up; or failed to begin.
   */
  outcome: 'began' | 'missed' | 'failed';
  /** When it began, when it did. */
  ranAt?: number;
  /** The chapter it began, and the folder that chat runs in. */
  chatId?: ChatId;
  cwd?: string;
  /** Why it failed. */
  error?: string;
}

/** A schedule, with when it runs next and how its last runs went. */
export interface ScheduleInfo extends Schedule {
  /** When it runs next; null while it's paused or names no days. */
  nextAt: number | null;
  /** Its last runs, newest first. */
  runs: ScheduleRun[];
}

declare module './commands' {
  interface CommandMap {
    /** The schedules, in the order they were made. */
    'schedules.list': { request: Record<string, never>; response: ScheduleInfo[] };
    /** Saves a schedule, a new one when it has no ID. Returns them all. */
    'schedules.save': { request: ScheduleDraft; response: ScheduleInfo[] };
    /** Removes a schedule and the record of its runs. Returns the rest. */
    'schedules.remove': { request: { id: string }; response: ScheduleInfo[] };
    /** Runs a schedule now, whatever its days: it begins its chapter as a scheduled run would. */
    'schedules.run': { request: { id: string }; response: ScheduleRun };
  }
}

declare module './events' {
  interface EventMap {
    /** The schedules, after one was saved, removed or ran. */
    'schedules.changed': { schedules: ScheduleInfo[] };
    /** A run began a chapter, which windows add to the book. */
    'schedules.began': { run: ScheduleRun; chat: OpenChat };
  }
}
