import { NgComponentOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { Facing } from './facing';
import { RunningHead } from './running-head';
import type { ThumbTab } from './shell-registry';

/**
 * A thumb tab's page on the facing page: its feature's own page, or a blank
 * one until the feature is written. Esc or Back turns back.
 */
@Component({
  selector: 'gr-thumb-page',
  imports: [NgComponentOutlet, RunningHead],
  templateUrl: './thumb-page.html',
  styleUrl: './thumb-page.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class ThumbPage {
  readonly tab = input.required<ThumbTab>();
  /** The label of the page it turns back to. */
  readonly backTo = input('facing page');

  protected readonly facing = inject(Facing);

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.facing.closeThumb();
  }
}
