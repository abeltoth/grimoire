import { Component, inject } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { GRIMOIRE_BRIDGE } from '../core/bridge';

/**
 * The window's minimize, maximize and close buttons, drawn on Windows;
 * on a Mac the system draws its own in the left corner, so these are left out.
 */
@Component({
  selector: 'gr-window-controls',
  imports: [Icon],
  template: `
    @if (platform !== 'mac') {
      <button type="button" aria-label="Minimize window" (click)="bridge.window.minimize()">
        <gr-icon name="minimize" />
      </button>
      <button type="button" aria-label="Maximize window" (click)="bridge.window.toggleMaximize()">
        <gr-icon name="maximize" />
      </button>
      <button type="button" aria-label="Close window" (click)="bridge.window.close()">
        <gr-icon name="close" />
      </button>
    }
  `,
  styleUrl: './window-controls.css',
})
export class WindowControls {
  protected readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly platform = this.bridge.platform;
}
