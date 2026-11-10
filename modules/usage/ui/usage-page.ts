import { Component, inject, signal } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { UsageLimits } from './usage-limits';
import { type UsageView, UsageTokens } from './usage-tokens';

const VIEWS: Record<UsageView, string> = {
  limits: 'Limits',
  tokens: 'Where it went',
  tools: 'Tools & skills',
};

/**
 * The Usage page: how much of each agent's subscription limits is used, read
 * from the agent when the page opens, each limit with when it resets; and
 * where the tokens went, as the agent's own scan says and by Grimoire's
 * count from the chats' transcripts, with the tools and skills used most.
 */
@Component({
  selector: 'gr-usage-page',
  imports: [UsageLimits, UsageTokens],
  templateUrl: './usage-page.html',
  styleUrls: ['./usage-picks.css', './usage-page.css'],
})
export class UsagePage {
  protected readonly wording = inject(Wording);

  protected readonly views = Object.entries(VIEWS) as [UsageView, string][];
  protected readonly view = signal<UsageView>('limits');
}
