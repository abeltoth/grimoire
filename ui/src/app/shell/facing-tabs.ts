import { Component, inject, input } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { Wording } from '../core/wording';
import { Facing } from './facing';
import { Focus } from './focus';
import { type FacingPageEntry, ShellRegistry } from './shell-registry';

/**
 * The first line of the facing page's running head: the tabs of what it
 * can show, as registered by features, and the way to a single page. Each
 * of the facing page's own pages heads with it, those drawn whole too.
 */
@Component({
  selector: 'gr-facing-tabs',
  imports: [Icon],
  template: `
    <nav class="tabs" [attr.aria-label]="wording.say('Facing page shows', 'Right page shows')">
      @for (entry of registry.facingPages.all(); track entry.id) {
        @let heading = entry.heading?.() || wording.label(entry);
        <button
          type="button"
          [attr.aria-pressed]="entry.id === current()"
          [attr.aria-disabled]="entry.component ? null : true"
          [attr.title]="heading"
          (click)="show(entry)"
        >
          {{ heading }}
        </button>
      }
    </nav>
    <span class="spacer"></span>
    <button type="button" class="gr-link" (click)="focus.enter()">
      <gr-icon name="single-page" />{{ wording.say('Single page', 'Focus') }}
    </button>
  `,
  styleUrl: './facing-tabs.css',
})
export class FacingTabs {
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly facing = inject(Facing);

  /** The ID of the page showing. */
  readonly current = input<string>();

  protected show(page: FacingPageEntry): void {
    if (page.component) this.facing.showPage(page.id);
  }
}
