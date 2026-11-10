import type { Card, CardColumn, EventName, EventPayload, JiraTransition } from '@grimoire/contract';
import { type Connectors, ToolFailed } from '@grimoire/service/claude/connectors';
import { type JiraSite, issueOf, jiraSaid, openJira, transitionIssue, transitionsOf } from './jira';
import type { CardStore } from './store';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** How long the Claude Code process that moves cards is kept after the last move: starting one takes seconds. */
const KEEP_MS = 2 * 60_000;

/**
 * Moves the board's Jira cards in Jira: lists the changes of status Jira
 * allows a card's issue, makes one, and reads the issue again for its
 * card, telling every window. They go through your claude.ai Atlassian
 * connector on a Claude Code process of their own, the one that may
 * change Jira: started on the first move, which takes some seconds, and
 * kept a couple of minutes after the last, so a move's next step and the
 * next move are quick. It's the profile in use's; another profile's moves
 * start one of their own. A sync begun before an issue was read again
 * doesn't put back what it found (JiraCards.replace).
 */
export class JiraMoves {
  private kept: Kept | undefined;

  constructor(
    private readonly cards: CardStore,
    private readonly open: (allowed: ReadonlySet<string>) => Promise<Connectors>,
    private readonly emit: Emit,
    private readonly log: (message: string) => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly keepMs: number = KEEP_MS,
  ) {}

  /** The changes of status Jira allows the card's issue now; only those into `column` when it's given. */
  async transitions(id: string, column?: CardColumn): Promise<JiraTransition[]> {
    const key = this.keyOf(id);
    const all = await this.use(async (jira) => {
      try {
        return await transitionsOf(jira, key);
      } catch (error) {
        throw new Error(`Jira didn’t say how ${key} can move: ${jiraSaid(error)}`, {
          cause: error,
        });
      }
    });
    return column ? all.filter((transition) => transition.column === column) : all;
  }

  /**
   * Changes the card's issue's status by the transition, then reads the
   * issue again for its card; when it can't be read, the card takes the
   * status the transition leads to. Rejects with what Jira said when it
   * refuses, the card as it was.
   */
  async transition(id: string, transition: JiraTransition): Promise<Card[]> {
    const profile = this.cards.profile();
    const key = this.keyOf(id);
    await this.use(async (jira) => {
      try {
        await transitionIssue(jira, key, transition.id);
      } catch (error) {
        const said = `Jira didn’t move ${key} to ${transition.status}: ${jiraSaid(error)}`;
        throw new Error(said, { cause: error });
      }
      try {
        this.cards.jira.update(profile, await issueOf(jira, key), this.now());
      } catch (error) {
        this.log(
          `Jira: ${key} moved to ${transition.status}, but couldn't be read again: ${jiraSaid(error)}`,
        );
        this.cards.jira.update(
          profile,
          { key, status: transition.status, column: transition.column },
          this.now(),
        );
      }
    });
    const cards = this.cards.list();
    if (this.cards.profile() === profile) this.emit('kanban.changed', { cards });
    return cards;
  }

  /** Stops the process kept, as the service stops. */
  close(): void {
    if (this.kept) this.drop(this.kept);
  }

  /** The issue's key of one of the profile in use's Jira cards. */
  private keyOf(id: string): string {
    const key = this.cards.jira.keyOf(this.cards.profile(), id);
    if (!key) throw new Error('There is no such Jira card');
    return key;
  }

  /**
   * Does the work on the Atlassian connector, on the process kept for the
   * profile in use, or a new one. One that can't reach it, or whose call
   * failed other than by Jira's own answer (an error caused by
   * ToolFailed), isn't kept: the next move starts another.
   */
  private async use<T>(work: (jira: JiraSite) => Promise<T>): Promise<T> {
    const profile = this.cards.profile();
    if (this.kept && this.kept.profile !== profile) this.drop(this.kept);
    const kept = (this.kept ??= { profile, site: openJira(this.open), using: 0 });
    clearTimeout(kept.idle);
    kept.using++;
    try {
      return await work(await kept.site);
    } catch (error) {
      if (!(error instanceof Error && error.cause instanceof ToolFailed)) this.drop(kept);
      throw error;
    } finally {
      kept.using--;
      if (!kept.using && this.kept === kept)
        kept.idle = setTimeout(() => this.drop(kept), this.keepMs).unref();
    }
  }

  private drop(kept: Kept): void {
    clearTimeout(kept.idle);
    if (this.kept === kept) this.kept = undefined;
    kept.site.then((jira) => jira.close()).catch(() => {});
  }
}

/** A Claude Code process kept to move a profile's cards, and how many moves are using it. */
interface Kept {
  profile: string;
  site: Promise<JiraSite>;
  using: number;
  idle?: NodeJS.Timeout;
}
