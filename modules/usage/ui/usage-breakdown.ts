import { Component, computed, inject, input, signal } from '@angular/core';
import type { AgentInfo } from '@grimoire/contract';
import { type AboutRow, UsageAbout } from './about-tip';
import { UsagePie, shareText } from './pie-chart';
import { ScanReadings } from './scan-readings';
import {
  behaviourCount,
  behaviourName,
  behaviourRule,
  counted,
  overlapping,
  sourceKind,
  sourceSlices,
  tipCommand,
} from './scan-format';
import { SPANS, type Span } from './token-readings';
import { filled, time } from './usage-format';

/**
 * What an agent's own scan says used its plan's limits, over the last 24
 * hours or 7 days: its ways of working, where the usage went, and its tips.
 */
@Component({
  selector: 'gr-usage-breakdown',
  imports: [UsageAbout, UsagePie],
  templateUrl: './usage-breakdown.html',
  styleUrls: [
    './usage-lists.css',
    './usage-picks.css',
    './usage-sections.css',
    './usage-breakdown.css',
  ],
})
export class UsageBreakdownPanel {
  protected readonly scans = inject(ScanReadings);

  readonly agent = input.required<AgentInfo>();

  protected readonly span = signal<Span>('week');
  protected readonly spans = Object.entries(SPANS) as [Span, { label: string; ms: number }][];

  private readonly breakdown = computed(() => this.scans.of(this.agent().id));
  /** The span shown; null until it's read, or where the agent has no scan. */
  protected readonly shown = computed(() => this.breakdown()?.[this.span()] ?? null);

  protected readonly about = computed((): AboutRow[] => {
    const at = this.breakdown()?.at;
    return [
      {
        text:
          `From ${this.agent().name}’s own scan of the chats on this computer` +
          (at ? `, read at ${time(at)}.` : '.'),
      },
      { text: 'A request weighs more for its output and fresh input, and on a bigger model.' },
    ];
  });

  /** What each way of working shown counts, and that they overlap. */
  protected readonly ways = computed((): AboutRow[] => [
    ...(this.shown()?.behaviours ?? []).flatMap((behaviour) => {
      const text = behaviourRule(behaviour.key);
      return text ? [{ head: behaviourName(behaviour.key), text }] : [];
    }),
    { text: 'They overlap, so their shares don’t add up to 100%.' },
  ]);

  protected readonly ring = computed(() => {
    const shown = this.shown();
    return shown ? sourceSlices(shown) : [];
  });

  protected readonly extras = computed(() => {
    const shown = this.shown();
    return shown ? overlapping(shown) : [];
  });

  protected readonly extrasAbout: AboutRow[] = [
    { text: 'Each counts in the ring too: in the chat, a subagent or a skill.' },
  ];

  protected readonly behaviourName = behaviourName;
  protected readonly behaviourCount = behaviourCount;
  protected readonly sourceKind = sourceKind;
  protected readonly counted = counted;
  protected readonly tipCommand = tipCommand;
  protected readonly share = shareText;
  protected readonly filled = filled;
}
