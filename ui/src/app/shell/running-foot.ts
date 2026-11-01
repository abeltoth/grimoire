import { Component } from '@angular/core';

/** The foot of a page: one line of small capitals under the text. */
@Component({
  selector: 'gr-running-foot',
  template: '<ng-content />',
  styleUrl: './running-foot.css',
})
export class RunningFoot {}
