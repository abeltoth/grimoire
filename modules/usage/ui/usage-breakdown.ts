import { Component, computed, inject, input } from '@angular/core';
import type { AgentInfo } from '@grimoire/contract';
import { ScanReadings } from './scan-readings';
import { tipCommand, tipReason } from './scan-format';
import { TokenReadings } from './token-readings';

/** A tip as the note shows it: what to do, the command to run, and why. */
interface Tip {
  key: string;
  title: string;
  command?: string;
  why?: string;
}

/**
 * What an agent's own scan of its chats advises over the Tokens tab's span,
 * each tip with why it's given, in a note of its own.
 */
@Component({
  selector: 'gr-usage-breakdown',
  templateUrl: './usage-breakdown.html',
  styleUrls: ['./usage-sections.css', './usage-breakdown.css'],
})
export class UsageBreakdownPanel {
  private readonly scans = inject(ScanReadings);
  private readonly readings = inject(TokenReadings);

  readonly agent = input.required<AgentInfo>();

  protected readonly tips = computed((): Tip[] => {
    const span = this.scans.of(this.agent().id)?.[this.readings.span()];
    if (!span) return [];
    return span.advice.map((advice) => {
      const command = tipCommand(advice.detail);
      // A detail that isn't a command says why, when Grimoire has no words of its own for it.
      const why = tipReason(advice, span) ?? (command ? undefined : advice.detail);
      return {
        key: advice.key + advice.title,
        title: advice.title,
        ...(command ? { command } : {}),
        ...(why ? { why } : {}),
      };
    });
  });
}
