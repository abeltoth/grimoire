/** How often the plan's limits are read, in ms. */
export interface ReadPace {
  /** While no chat has worked for a while. */
  idle: number;
  /** While a chat works, or did lately. */
  busy: number;
  /** How long after a chat last worked it still counts as lately. */
  lately: number;
}

/**
 * Reads the plan's limits now and again: often while chats work, since
 * that's when they're used up, and seldom otherwise, as claude.ai and
 * other machines use them too. Each read starts a Claude Code process, so
 * a read that fails waits twice as long before the next, up to the idle pace.
 */
export class ReadSchedule {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRead = -Infinity;
  private lastBusy = -Infinity;
  private failures = 0;
  private reading = false;
  private running = false;

  /** `read` rejects when any agent's plan couldn't be read. */
  constructor(
    private readonly read: () => Promise<void>,
    private readonly pace: ReadPace,
    private readonly now: () => number,
  ) {}

  /** Reads now, and from then on at the pace. */
  start(): void {
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** A chat works: the next read comes at the busy pace, at once if the last is that old. */
  busy(): void {
    this.lastBusy = this.now();
    this.plan();
  }

  private async tick(): Promise<void> {
    clearTimeout(this.timer);
    this.reading = true;
    this.lastRead = this.now();
    try {
      await this.read();
      this.failures = 0;
    } catch {
      this.failures++;
    } finally {
      this.reading = false;
    }
    this.plan();
  }

  private plan(): void {
    if (!this.running || this.reading) return;
    const lately = this.now() - this.lastBusy < this.pace.lately;
    const pace = lately ? this.pace.busy : this.pace.idle;
    const every = Math.min(pace * 2 ** this.failures, Math.max(pace, this.pace.idle));
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.tick(),
      Math.max(this.lastRead + every - this.now(), 0),
    );
    this.timer.unref?.();
  }
}
