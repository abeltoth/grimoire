import { Component, inject } from '@angular/core';
import { ShellRegistry } from './shell-registry';

/** The registered stamps, for a chapter's running head, such as its pull request's review. */
@Component({
  selector: 'gr-review-stamps',
  template: `
    @for (stamp of registry.stamps.all(); track stamp.id) {
      <button
        type="button"
        class="stamp"
        [class.alert]="stamp.tone === 'alert'"
        [class.quiet]="stamp.tone === 'quiet'"
        [attr.title]="stamp.detail ?? null"
        [attr.aria-disabled]="stamp.open ? null : true"
        (click)="stamp.open?.()"
      >
        {{ stamp.label }}
      </button>
    }
  `,
  styleUrl: './review-stamps.css',
  host: { role: 'group', 'aria-label': 'Review stamps' },
})
export class ReviewStamps {
  protected readonly registry = inject(ShellRegistry);
}
