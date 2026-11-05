import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Drawing } from '../../design-system/drawing';
import { Icon } from '../../design-system/icon';
import { Wording } from '../core/wording';
import { CommandIndex } from './command-index';
import { IndexPage } from './index-page';
import { Page } from './page';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';
import { Facing } from './facing';
import { ThumbPage } from './thumb-page';
import { type FacingPageEntry, ShellRegistry } from './shell-registry';

/**
 * The right-hand page. Its running head lists what it can show, as
 * registered by features; the first one that can be picked shows first.
 * The seal ribbon turns it to the slips awaiting your seal for a while,
 * the Index's thumb notch or shortcut to the Index, "/" at the start of
 * an entry to the agent's commands, and the other thumb tabs to their pages.
 */
@Component({
  selector: 'gr-facing-page',
  imports: [
    CommandIndex,
    Drawing,
    Icon,
    IndexPage,
    NgComponentOutlet,
    Page,
    RunningFoot,
    RunningHead,
    ThumbPage,
  ],
  templateUrl: './facing-page.html',
  styleUrl: './facing-page.css',
})
export class FacingPage {
  protected readonly registry = inject(ShellRegistry);
  protected readonly facing = inject(Facing);
  protected readonly wording = inject(Wording);

  protected readonly shown = computed<FacingPageEntry | undefined>(() => {
    const pages = this.registry.facingPages.all().filter((page) => page.component);
    return pages.find((page) => page.id === this.facing.page()) ?? pages[0];
  });

  /** The label of the page the Index, a thumb tab's page or the seals turn back to. */
  protected readonly back = computed(() => {
    const page = this.shown();
    return page ? this.wording.label(page) : 'facing page';
  });

  /** The thumb tab whose page shows, if any. */
  protected readonly thumb = computed(() => {
    const id = this.facing.thumb();
    return id === null ? undefined : this.registry.thumbs.get(id);
  });

  protected show(page: FacingPageEntry): void {
    if (page.component) this.facing.showPage(page.id);
  }
}
