import type { EventName, EventPayload, JiraSync } from '@grimoire/contract';
import type { Connectors } from '../agents/claude/connectors';
import { fetchJira } from './jira';
import type { CardStore } from './store';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/**
 * Keeps the board's Jira issues in step with Jira: each sync fetches those
 * the query in the settings finds, through your claude.ai Atlassian
 * connector, in place of those there. One sync runs at a time, for the
 * profile in use as it begins; what it finds goes to that profile's board,
 * and every window is told while that profile is still in use. When it
 * can't fetch them, the issues last fetched stay.
 */
export class JiraSyncer {
  private running: { profile: string; done: Promise<void> } | undefined;
  /** When each profile's last sync began. */
  private readonly begun = new Map<string, number>();

  constructor(
    private readonly cards: CardStore,
    private readonly query: () => string,
    private readonly open: (allowed: ReadonlySet<string>) => Promise<Connectors>,
    private readonly emit: Emit,
    private readonly log: (message: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Where the board's Jira issues stand, in the profile in use. */
  state(): JiraSync {
    const profile = this.cards.profile();
    return { ...this.cards.jira.state(profile), syncing: this.running?.profile === profile };
  }

  /**
   * Syncs the profile in use's issues, or waits for the sync running for
   * it; skipped when its last sync began less than `ifOlderThan` ms ago.
   */
  async sync({ ifOlderThan }: { ifOlderThan?: number } = {}): Promise<JiraSync> {
    const profile = this.cards.profile();
    if (this.running) {
      const { profile: runningFor, done } = this.running;
      await done;
      if (runningFor === profile) return this.state();
      return this.sync({ ifOlderThan });
    }
    const last = this.begun.get(profile);
    if (ifOlderThan !== undefined && last !== undefined && this.now() - last < ifOlderThan) {
      return this.state();
    }
    this.begun.set(profile, this.now());
    const done = this.run(profile);
    this.running = { profile, done };
    this.tell(profile);
    try {
      await done;
    } finally {
      this.running = undefined;
    }
    this.tell(profile);
    return this.state();
  }

  /** Syncs every so often, until the service stops. */
  syncEvery(ms: number): void {
    setInterval(() => void this.sync(), ms).unref();
  }

  private async run(profile: string): Promise<void> {
    const fetched = await fetchJira(this.open, this.query());
    try {
      if (fetched.outcome === 'synced') {
        this.cards.jira.replace(profile, fetched.issues, this.now());
        if (this.cards.profile() === profile) this.emit('kanban.changed', { cards: this.cards.list() });
      } else {
        const error = fetched.outcome === 'failed' ? fetched.error : undefined;
        if (error) this.log(`Jira sync failed: ${error}`);
        this.cards.jira.note(profile, fetched.outcome, error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Jira sync failed: ${message}`);
      this.cards.jira.note(profile, 'failed', message);
    }
  }

  /** Tells every window where the issues stand, while the profile is still in use. */
  private tell(profile: string): void {
    if (this.cards.profile() === profile) this.emit('kanban.jira', { jira: this.state() });
  }
}
