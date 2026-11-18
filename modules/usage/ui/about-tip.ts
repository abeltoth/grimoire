import { Component, computed, input, signal } from '@angular/core';
import { Icon } from '@ui/design-system/icon';

/** A line of an explanation: a name with its figure in bold, such as a price, and a sentence under it. */
export interface AboutRow {
  head?: string;
  value?: string;
  text?: string;
}

/** An explanation in plain words, for a screen reader. */
export function aboutText(rows: readonly AboutRow[]): string {
  return rows
    .map(({ head, value, text }) =>
      [[head, value].filter(Boolean).join(', '), text].filter(Boolean).join(': '),
    )
    .join(' ');
}

/** An icon that tells what something means in a tooltip of its own, on hover or focus. */
@Component({
  selector: 'gr-usage-about',
  imports: [Icon],
  template: `
    <span
      class="about"
      tabindex="0"
      role="img"
      [attr.aria-label]="spoken()"
      (mouseenter)="open.set(true)"
      (mouseleave)="open.set(false)"
      (focus)="open.set(true)"
      (blur)="open.set(false)"
    >
      <gr-icon name="info" />
      @if (open()) {
        <span class="about-tip" aria-hidden="true">
          @for (row of rows(); track $index) {
            <span class="about-row">
              @if (row.head || row.value) {
                <span class="about-head">
                  {{ row.head }}
                  @if (row.head && row.value) {
                    ·
                  }
                  @if (row.value) {
                    <strong>{{ row.value }}</strong>
                  }
                </span>
              }
              @if (row.text) {
                <span>{{ row.text }}</span>
              }
            </span>
          }
        </span>
      }
    </span>
  `,
  styleUrl: './about-tip.css',
})
export class UsageAbout {
  readonly rows = input.required<readonly AboutRow[]>();

  protected readonly spoken = computed(() => aboutText(this.rows()));
  protected readonly open = signal(false);
}
