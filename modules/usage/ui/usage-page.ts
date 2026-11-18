import { Component, inject, signal } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { ScanReadings } from './scan-readings';
import { TokenReadings } from './token-readings';
import { UsageLimits } from './usage-limits';
import { UsageTokens } from './usage-tokens';
import { UsageTools } from './usage-tools';

/** The Usage page's tabs. */
type UsageView = 'limits' | 'tokens' | 'tools';

const VIEWS: Record<UsageView, string> = {
  limits: 'Limits',
  tokens: 'Tokens',
  tools: 'Tools & skills',
};

/**
 * The Usage page: how much of each agent's subscription limits is used, read
 * from the agent when the page opens, each limit with when it resets; the
 * agent's own scan of what used them; the tokens, by Grimoire's count from
 * the chats' transcripts; and the tools and skills used most.
 */
@Component({
  selector: 'gr-usage-page',
  imports: [UsageLimits, UsageTokens, UsageTools],
  // Read once for the page, whichever tab shows them.
  providers: [TokenReadings, ScanReadings],
  templateUrl: './usage-page.html',
  styleUrls: ['./usage-picks.css', './usage-page.css'],
})
export class UsagePage {
  protected readonly wording = inject(Wording);

  protected readonly views = Object.entries(VIEWS) as [UsageView, string][];
  protected readonly view = signal<UsageView>('limits');
}
