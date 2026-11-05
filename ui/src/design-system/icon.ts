import { Component, input } from '@angular/core';

export type IconName =
  | 'quill'
  | 'bell'
  | 'circle'
  | 'moon'
  | 'page'
  | 'plus'
  | 'branch'
  | 'chevron-down'
  | 'single-page'
  | 'two-pages'
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'pen'
  | 'pop-out'
  | 'attach'
  | 'parallel'
  | 'hourglass'
  | 'seal'
  | 'tick'
  | 'check'
  | 'ornament';

/** The theme's icons, drawn in the current text colour at their design size. */
@Component({
  selector: 'gr-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.css',
  host: { 'aria-hidden': 'true' },
})
export class Icon {
  readonly name = input.required<IconName>();
}
