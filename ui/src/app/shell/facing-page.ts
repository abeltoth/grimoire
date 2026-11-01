import { NgComponentOutlet } from '@angular/common';
import { Component, inject, linkedSignal } from '@angular/core';
import { Drawing } from '../../design-system/drawing';
import { Icon } from '../../design-system/icon';
import { IndexPage } from './index-page';
import { Page } from './page';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';
import { Facing } from './facing';
import { type FacingPageEntry, ShellRegistry } from './shell-registry';

/**
 * The right-hand page. Its running head lists what it can show, as
 * registered by features; the first one that can be picked shows first.
 * The seal ribbon turns it to the slips awaiting your seal for a while,
 * and the Index's thumb notch or shortcut to the Index.
 */
@Component({
  selector: 'gr-facing-page',
  imports: [Drawing, Icon, IndexPage, NgComponentOutlet, Page, RunningFoot, RunningHead],
  templateUrl: './facing-page.html',
  styleUrl: './facing-page.css',
})
export class FacingPage {
  protected readonly registry = inject(ShellRegistry);
  protected readonly facing = inject(Facing);

  protected readonly shown = linkedSignal<FacingPageEntry | undefined>(() =>
    this.registry.facingPages.all().find((page) => page.component),
  );

  protected show(page: FacingPageEntry): void {
    if (page.component) this.shown.set(page);
  }
}
