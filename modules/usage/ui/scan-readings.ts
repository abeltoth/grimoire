import { Injectable, PendingTasks, effect, inject, signal, untracked } from '@angular/core';
import type { AgentId, AgentInfo, UsageBreakdown } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';

/** An agent's own word on where its plan's usage went. */
export interface Breakdown {
  agent: AgentInfo;
  breakdown: UsageBreakdown;
}

/**
 * What each agent's own scan of its transcripts says used its plan's
 * limits, kept by the Usage page: read once the agents are known, and
 * again with the limits, since the scan reads every chat of the week.
 */
@Injectable()
export class ScanReadings {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly catalog = inject(AgentCatalog);
  private readonly pending = inject(PendingTasks);

  /** Undefined until the agents have answered; an agent without a scan isn't in it. */
  readonly scans = signal<Breakdown[] | undefined>(undefined);
  readonly failed = signal<string | null>(null);
  readonly reading = signal(false);

  constructor() {
    effect(() => {
      if (this.catalog.agents().length) untracked(() => void this.read());
    });
  }

  /** An agent's scan: undefined until read, null where it has none. */
  of(agent: AgentId): UsageBreakdown | null | undefined {
    const scans = this.scans();
    return scans && (scans.find((each) => each.agent.id === agent)?.breakdown ?? null);
  }

  async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.catalog.agents();
      const answers = await Promise.all(
        agents.map((agent) => this.bridge.invoke('usage.breakdown', { agent: agent.id })),
      );
      this.scans.set(
        agents.flatMap((agent, i) => {
          const breakdown = answers[i];
          return breakdown ? [{ agent, breakdown }] : [];
        }),
      );
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.reading.set(false);
      done();
    }
  }
}
