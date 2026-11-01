import { Component, inject } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { ShellRegistry } from './shell-registry';

/** The registered indicators, for a chapter's running foot. */
@Component({
  selector: 'gr-status-indicators',
  imports: [Icon],
  template: `
    @for (indicator of registry.indicators.all(); track indicator.id; let first = $first) {
      @if (!first) {
        <span aria-hidden="true">·</span>
      }
      <button
        type="button"
        class="gr-link"
        [attr.aria-disabled]="indicator.open ? null : true"
        (click)="indicator.open?.()"
      >
        @if (indicator.icon) {
          <gr-icon [name]="indicator.icon" />
        }
        {{ indicator.label }}
      </button>
    }
  `,
  styleUrl: './status-indicators.css',
})
export class StatusIndicators {
  protected readonly registry = inject(ShellRegistry);
}
