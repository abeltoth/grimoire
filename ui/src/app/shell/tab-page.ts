import { NgComponentOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Wording } from '../core/wording';
import { RightPageState } from './right-page-state';
import { PageHeader } from './page-header';
import type { PageTab } from './shell-registry';

/**
 * A page tab's page on the right page: its feature's own page, or a blank
 * one until the feature is written. Esc or Back turns back.
 */
@Component({
  selector: 'gr-tab-page',
  imports: [NgComponentOutlet, PageHeader],
  templateUrl: './tab-page.html',
  styleUrl: './tab-page.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class TabPage {
  readonly tab = input.required<PageTab>();
  /** The label of the page it turns back to. */
  readonly backTo = input.required<string>();

  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.rightPage.closePageTab();
  }
}
