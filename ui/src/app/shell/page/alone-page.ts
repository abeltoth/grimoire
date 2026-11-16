import { NgComponentOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Icon } from '../../../design-system/icon';
import { Wording } from '../../core/wording';
import { Focus } from '../focus';
import { RightPageState } from '../right-page/right-page-state';
import { PageHeader } from './page-header';
import type { RightPageEntry } from '../shell-registry';

/**
 * One of the right page's own pages, lying alone in focus mode in the
 * chat's place. Esc or Back lays the chat there again; Two pages opens
 * the book, the page on the right beside the chat.
 */
@Component({
  selector: 'gr-alone-page',
  imports: [Icon, NgComponentOutlet, PageHeader],
  template: `
    <gr-page-header>
      <div class="row">
        <h2 class="title">{{ wording.label(page()) }}</h2>
        <span class="spacer"></span>
        <button type="button" class="gr-link" (click)="twoPages()">
          <gr-icon name="two-pages" />{{ wording.say('Two pages', 'Leave focus') }}
        </button>
        <button type="button" class="gr-link" (click)="focus.lay(null)">
          {{ wording.back(wording.say('chapter', 'chat')) }} <span class="gr-kbd">Esc</span>
        </button>
      </div>
    </gr-page-header>
    <div class="body">
      @if (page().component; as component) {
        <ng-container *ngComponentOutlet="component" />
      }
    </div>
  `,
  styleUrl: './tab-page.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class AlonePage {
  readonly page = input.required<RightPageEntry>();

  protected readonly focus = inject(Focus);
  protected readonly wording = inject(Wording);
  private readonly rightPage = inject(RightPageState);

  /** Leaves focus mode with the page on the right, where it was alone. */
  protected twoPages(): void {
    this.rightPage.showPage(this.page().id);
    this.focus.leave();
  }

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.focus.lay(null);
  }
}
