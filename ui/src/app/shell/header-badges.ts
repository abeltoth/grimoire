import { Component, inject } from '@angular/core';
import { ShellRegistry } from './shell-registry';

/** The registered badges, for a chat's page header, such as its pull request's review. */
@Component({
  selector: 'gr-header-badges',
  template: `
    @for (badge of registry.badges.all(); track badge.id) {
      <button
        type="button"
        class="badge"
        [class.alert]="badge.tone === 'alert'"
        [class.quiet]="badge.tone === 'quiet'"
        [attr.title]="badge.detail ?? null"
        [attr.aria-disabled]="badge.open ? null : true"
        (click)="badge.open?.()"
      >
        {{ badge.label }}
      </button>
    }
  `,
  styleUrl: './header-badges.css',
  host: { role: 'group', 'aria-label': 'Review stamps' },
})
export class HeaderBadges {
  protected readonly registry = inject(ShellRegistry);
}
