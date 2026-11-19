import { Component, inject } from '@angular/core';
import { ScanReadings } from './scan-readings';
import { SPANS, type Span, TokenReadings } from './token-readings';

/** The spans the tokens are shown over, and "Read again", above the Tokens tab. */
@Component({
  selector: 'gr-usage-spans',
  template: `
    <p class="sub">
      <span class="spans" role="radiogroup" aria-label="Over">
        @for (each of spans; track each[0]) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="readings.span() === each[0]"
            (click)="readings.showSpan(each[0])"
          >
            {{ each[1].label }}
          </button>
        }
      </span>
      <span class="dot" aria-hidden="true">·</span>
      <button
        type="button"
        class="gr-link"
        [attr.aria-disabled]="readings.reading() || null"
        (click)="readAgain()"
      >
        Read again
      </button>
    </p>
  `,
  styleUrls: ['./usage-lists.css', './usage-picks.css'],
})
export class UsageSpans {
  protected readonly readings = inject(TokenReadings);
  private readonly scans = inject(ScanReadings);
  protected readonly spans = Object.entries(SPANS) as [Span, { label: string; ms: number }][];

  /** Counts the tokens again, and asks the agents for their scan again. */
  protected readAgain(): void {
    void this.readings.read();
    void this.scans.read();
  }
}
