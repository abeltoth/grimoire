import { Component, inject, input } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { Wording } from '../core/wording';
import { RightPageState } from './right-page-state';
import { Focus } from './focus';
import { type RightPageEntry, ShellRegistry } from './shell-registry';

/**
 * The first line of the right page's page header: the tabs of what it
 * can show, as registered by features, and the way to a single page. Each
 * of the right page's own pages heads with it, those drawn whole too.
 */
@Component({
  selector: 'gr-right-page-tabs',
  imports: [Icon],
  template: `
    <nav class="tabs" [attr.aria-label]="wording.say('Facing page shows', 'Right page shows')">
      @for (entry of registry.rightPages.all(); track entry.id) {
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
  styleUrl: './right-page-tabs.css',
})
export class RightPageTabs {
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly rightPage = inject(RightPageState);

  /** The ID of the page showing. */
  readonly current = input<string>();

  protected show(page: RightPageEntry): void {
    if (page.component) this.rightPage.showPage(page.id);
  }
}
