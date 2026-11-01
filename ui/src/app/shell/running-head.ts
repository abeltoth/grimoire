import { Component } from '@angular/core';

/** The head of a page, above a double rule. Its rows go inside. */
@Component({
  selector: 'gr-running-head',
  template: '<ng-content />',
  styleUrl: './running-head.css',
})
export class RunningHead {}
