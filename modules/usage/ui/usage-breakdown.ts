import { Component, computed, inject, input } from '@angular/core';
import type { AgentInfo } from '@grimoire/contract';
import { type AboutRow, UsageAbout } from './about-tip';
import { shareText } from './pie-chart';
import { ScanReadings } from './scan-readings';
import {
  behaviourCount,
  behaviourName,
  behaviourRule,
  overlapping,
  sourceKind,
  tipCommand,
} from './scan-format';
import { TokenReadings } from './token-readings';
import { filled } from './usage-format';

/** A way of working as its row shows it, with what the scan counts in it when Grimoire knows. */
interface Way {
  key: string;
  name: string;
  count: string;
  share: number;
  rule: AboutRow[] | null;
}

/**
 * What an agent's own scan says of its usage over the Tokens tab's span: its
 * ways of working, the plugins and MCP servers that took a share, and its tips.
 */
@Component({
  selector: 'gr-usage-breakdown',
  imports: [UsageAbout],
  templateUrl: './usage-breakdown.html',
  styleUrls: ['./usage-lists.css', './usage-sections.css', './usage-breakdown.css'],
})
export class UsageBreakdownPanel {
  private readonly scans = inject(ScanReadings);
  private readonly readings = inject(TokenReadings);

  readonly agent = input.required<AgentInfo>();

  /** The span the tab shows; null until it's read, or where the agent has no scan. */
  protected readonly shown = computed(
    () => this.scans.of(this.agent().id)?.[this.readings.span()] ?? null,
  );

  protected readonly ways = computed((): Way[] =>
    (this.shown()?.behaviours ?? []).map(({ key, share, requests }) => {
      const rule = behaviourRule(key);
      return {
        key,
        name: behaviourName(key),
        count: behaviourCount(key, requests),
        share,
        rule: rule ? [{ text: rule }] : null,
      };
    }),
  );

  protected readonly extras = computed(() => {
    const shown = this.shown();
    return shown ? overlapping(shown) : [];
  });

  protected readonly sourceKind = sourceKind;
  protected readonly tipCommand = tipCommand;
  protected readonly share = shareText;
  protected readonly filled = filled;
}
