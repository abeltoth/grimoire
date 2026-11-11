import { Component, input } from '@angular/core';
import { Drawing } from '../../../design-system/drawing';

/**
 * The open book: the cover with its gilt line and spine ornament, and the
 * spread between the page blocks. The pages and the page tabs go inside.
 * In focus mode its leaves lie on the desk out of their cover, a single
 * page when the facing one is put away.
 */
@Component({
  selector: 'gr-frame',
  imports: [Drawing],
  template: `
    @if (!bare()) {
      <gr-drawing class="ornament" name="spine" />
    }
    <div class="spread"><ng-content /></div>
  `,
  styleUrl: './frame.css',
  host: { '[class.bare]': 'bare()', '[class.single]': 'single()' },
})
export class Frame {
  /** Out of its cover, the leaves on the desk. */
  readonly bare = input(false);
  /** One page only, so there's no spine between pages. */
  readonly single = input(false);
}
