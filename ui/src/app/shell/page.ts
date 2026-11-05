import { Component, input } from '@angular/core';

/**
 * One page of the spread, shaded towards the spine. It sets the page's
 * margins, --page-inset-start and --page-inset-end, for the running head,
 * the running foot and the text in between.
 */
@Component({
  selector: 'gr-page',
  template: '<ng-content />',
  styleUrl: './page.css',
  host: { role: 'region', '[class.facing]': "side() === 'right'", '[class.alone]': 'alone()' },
})
export class Page {
  readonly side = input.required<'left' | 'right'>();
  /** The only page showing, with no spine to shade towards. */
  readonly alone = input(false);
}
