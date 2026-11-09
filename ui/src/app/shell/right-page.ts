import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Drawing } from '../../design-system/drawing';
import { Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { SlashCommands } from './slash-commands';
import { CommandPalette } from './command-palette';
import { Page } from './page';
import { PageFooter } from './page-footer';
import { PageHeader } from './page-header';
import { RightPageState } from './right-page-state';
import { RightPageTabs } from './right-page-tabs';
import { Focus } from './focus';
import { TabPage } from './tab-page';
import { type RightPageEntry, ShellRegistry } from './shell-registry';

/**
 * The right-hand page. Its page header lists what it can show, as
 * registered by features; the first one that can be picked shows first.
 * The approvals tab turns it to the waiting approvals for a while,
 * the command palette's tab or shortcut to the command palette, "/" at the start of
 * a message to the agent's commands, and the other page tabs to their pages.
 * The commands searched from the chat on the right page show on the
 * left page instead, so the message field stays in view. A page drawn whole heads
 * itself with the tabs.
 */
@Component({
  selector: 'gr-right-page',
  imports: [
    SlashCommands,
    Drawing,
    RightPageTabs,
    CommandPalette,
    NgComponentOutlet,
    Page,
    PageFooter,
    PageHeader,
    TabPage,
  ],
  templateUrl: './right-page.html',
  styleUrl: './right-page.css',
})
export class RightPage {
  protected readonly registry = inject(ShellRegistry);
  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly chats = inject(Chats);

  protected readonly shown = computed<RightPageEntry | undefined>(() => {
    const pages = this.registry.rightPages.all().filter((page) => page.component);
    return pages.find((page) => page.id === this.rightPage.page()) ?? pages[0];
  });

  /**
   * The label of the page the command palette, a page tab's page or the approvals turn
   * back to; in focus mode, the chat's page alone.
   */
  protected readonly back = computed(() => {
    if (this.focus.on()) return this.wording.say('single page', 'focus');
    const page = this.shown();
    return page ? this.wording.label(page) : this.wording.say('facing page', 'right page');
  });

  /** Whether the agent's commands show here: not those searched from the chat on this page. */
  protected readonly commandsHere = computed(() => {
    const search = this.rightPage.commands();
    return !!search && search.chatId !== this.chats.besideId();
  });

  /** What the right-hand page is called. */
  protected readonly rightPageLabel = computed(() => this.wording.say('Facing page', 'Right page'));

  /** The page tab whose page shows, if any. */
  protected readonly pageTab = computed(() => {
    const id = this.rightPage.pageTab();
    return id === null ? undefined : this.registry.pageTabs.get(id);
  });
}
