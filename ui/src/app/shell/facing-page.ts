import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Drawing } from '../../design-system/drawing';
import { Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { CommandIndex } from './command-index';
import { IndexPage } from './index-page';
import { Page } from './page';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';
import { Facing } from './facing';
import { FacingTabs } from './facing-tabs';
import { Focus } from './focus';
import { ThumbPage } from './thumb-page';
import { type FacingPageEntry, ShellRegistry } from './shell-registry';

/**
 * The right-hand page. Its running head lists what it can show, as
 * registered by features; the first one that can be picked shows first.
 * The seal ribbon turns it to the slips awaiting your seal for a while,
 * the Index's thumb notch or shortcut to the Index, "/" at the start of
 * an entry to the agent's commands, and the other thumb tabs to their pages.
 * The commands looked up from the chapter on the facing page show on the
 * left page instead, so the entry stays in view. A page drawn whole heads
 * itself with the tabs.
 */
@Component({
  selector: 'gr-facing-page',
  imports: [
    CommandIndex,
    Drawing,
    FacingTabs,
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
  protected readonly focus = inject(Focus);
  private readonly chats = inject(Chats);

  protected readonly shown = computed<FacingPageEntry | undefined>(() => {
    const pages = this.registry.facingPages.all().filter((page) => page.component);
    return pages.find((page) => page.id === this.facing.page()) ?? pages[0];
  });

  /**
   * The label of the page the Index, a thumb tab's page or the seals turn
   * back to; in focus mode, the chapter's page alone.
   */
  protected readonly back = computed(() => {
    if (this.focus.on()) return this.wording.say('single page', 'focus');
    const page = this.shown();
    return page ? this.wording.label(page) : this.wording.say('facing page', 'right page');
  });

  /** Whether the agent's commands show here: not those looked up from the chapter on this page. */
  protected readonly commandsHere = computed(() => {
    const lookUp = this.facing.commands();
    return !!lookUp && lookUp.chapterId !== this.chats.besideId();
  });

  /** What the right-hand page is called. */
  protected readonly facingPage = computed(() => this.wording.say('Facing page', 'Right page'));

  /** The thumb tab whose page shows, if any. */
  protected readonly thumb = computed(() => {
    const id = this.facing.thumb();
    return id === null ? undefined : this.registry.thumbs.get(id);
  });
}
