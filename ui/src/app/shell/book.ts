import { Component } from '@angular/core';
import { Drawing } from '../../design-system/drawing';

/**
 * The open book: the cover with its gilt line and spine ornament, and the
 * spread between the page blocks. The pages and the thumb index go inside.
 */
@Component({
  selector: 'gr-book',
  imports: [Drawing],
  template: '<gr-drawing class="ornament" name="spine" /><div class="spread"><ng-content /></div>',
  styleUrl: './book.css',
})
export class Book {}
