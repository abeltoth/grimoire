import { NgComponentOutlet } from '@angular/common';
import { Component, inject, linkedSignal } from '@angular/core';
import { Drawing } from '../../design-system/drawing';
import { Icon } from '../../design-system/icon';
import { Page } from './page';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';
import { type FacingPageEntry, ShellRegistry } from './shell-registry';

/**
 * The right-hand page. Its running head lists what it can show, as
 * registered by features; the first one that can be picked shows first.
 */
@Component({
  selector: 'gr-facing-page',
  imports: [Drawing, Icon, NgComponentOutlet, Page, RunningFoot, RunningHead],
  templateUrl: './facing-page.html',
  styleUrl: './facing-page.css',
})
export class FacingPage {
  protected readonly registry = inject(ShellRegistry);

  protected readonly shown = linkedSignal<FacingPageEntry | undefined>(() =>
    this.registry.facingPages.all().find((page) => page.component),
  );

  protected show(page: FacingPageEntry): void {
    if (page.component) this.shown.set(page);
  }
}
