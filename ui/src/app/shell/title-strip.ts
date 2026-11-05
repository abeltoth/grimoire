import { Component, input } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { WindowControls } from './window-controls';

/**
 * The strip above the book: the profile's name in the middle, and drawn
 * window controls on Windows. On a Mac the system draws its own buttons
 * in the left corner. The strip drags the window.
 */
@Component({
  selector: 'gr-title-strip',
  imports: [Icon, WindowControls],
  templateUrl: './title-strip.html',
  styleUrl: './title-strip.css',
  host: { role: 'banner' },
})
export class TitleStrip {
  readonly profile = input.required<string>();
}
