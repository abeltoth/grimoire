import { Component, inject, input } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { GRIMOIRE_BRIDGE } from '../core/bridge';

/**
 * The strip above the book: the profile's name in the middle, and drawn
 * window controls on Windows. On a Mac the system draws its own buttons
 * in the left corner. The strip drags the window.
 */
@Component({
  selector: 'gr-title-strip',
  imports: [Icon],
  templateUrl: './title-strip.html',
  styleUrl: './title-strip.css',
  host: { role: 'banner' },
})
export class TitleStrip {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly profile = input.required<string>();

  protected readonly platform = this.bridge.platform;

  protected minimize(): void {
    this.bridge.window.minimize();
  }

  protected toggleMaximize(): void {
    this.bridge.window.toggleMaximize();
  }

  protected close(): void {
    this.bridge.window.close();
  }
}
