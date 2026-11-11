import { Component } from '@angular/core';

/** The foot of a page: one line of small capitals under the text. */
@Component({
  selector: 'gr-page-footer',
  template: '<ng-content />',
  styleUrl: './page-footer.css',
})
export class PageFooter {}
