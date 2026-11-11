import { Component } from '@angular/core';

/** The head of a page, above a double rule. Its rows go inside. */
@Component({
  selector: 'gr-page-header',
  template: '<ng-content />',
  styleUrl: './page-header.css',
})
export class PageHeader {}
