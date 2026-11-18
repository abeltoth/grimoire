import { Component, inject, input } from '@angular/core';
import { Wording } from '../../core/wording';
import { RightPageState } from './right-page-state';
import { type RightPageEntry, ShellRegistry } from '../shell-registry';

/**
 * The first line of the right page's page header: the tabs of what it
 * can show, as registered by features. Each
 * of the right page's own pages heads with it, those drawn whole too.
 */
@Component({
  selector: 'gr-right-page-tabs',
  template: `
    <nav class="tabs" [attr.aria-label]="wording.say('Facing page shows', 'Right page shows')">
      @for (entry of registry.rightPages.all(); track entry.id) {
        @let heading = entry.heading?.() || wording.label(entry);
        <button
          type="button"
          [attr.aria-pressed]="entry.id === current()"
          [attr.aria-disabled]="entry.load ? null : true"
          [attr.title]="heading"
          (click)="show(entry)"
        >
          {{ heading }}
        </button>
      }
    </nav>
  `,
  styleUrl: './right-page-tabs.css',
})
export class RightPageTabs {
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  private readonly rightPage = inject(RightPageState);

  /** The ID of the page showing. */
  readonly current = input<string>();

  protected show(page: RightPageEntry): void {
    if (page.load) this.rightPage.showPage(page.id);
  }
}
