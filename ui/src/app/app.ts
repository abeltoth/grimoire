import { NgComponentOutlet } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { DesignSettings } from '../design-system/design-settings';
import { GRIMOIRE_BRIDGE } from './core/bridge';
import { ChatList } from './core/chat-list';
import { ServiceStatus } from './core/service-status';
import { Wording } from './core/wording';
import { Frame } from './shell/window/frame';
import { CommandPalette } from './shell/command-palette';
import { RightPage } from './shell/right-page/right-page';
import { RightPageState } from './shell/right-page/right-page-state';
import { Focus } from './shell/focus';
import { AlonePage } from './shell/page/alone-page';
import { Page } from './shell/page/page';
import { ChatTabs } from './shell/tabs/chat-tabs';
import { PageFooter } from './shell/page/page-footer';
import { ShellRegistry } from './shell/shell-registry';
import { matchesShortcut } from './shell/shortcut';
import { StatusIndicators } from './shell/status-indicators';
import { PageTabs } from './shell/page/page-tabs';
import { TitleBar } from './shell/window/title-bar';
import { WindowControls } from './shell/window/window-controls';

/**
 * The window: the title bar, and the open book on the desk with its
 * chat tabs. The left page shows the open chat through the page the chat
 * module registers, or the command palette of the chat on the right
 * page. Registered commands run from their
 * shortcuts. In focus mode the chat's page lies alone in the middle of
 * the desk, or one of the right page's own pages in its place.
 */
@Component({
  selector: 'gr-root',
  imports: [
    AlonePage,
    Frame,
    CommandPalette,
    RightPage,
    NgComponentOutlet,
    Page,
    ChatTabs,
    PageFooter,
    StatusIndicators,
    PageTabs,
    TitleBar,
    WindowControls,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '[attr.data-service-state]': 'service.state()',
    '[class.focus]': 'bare()',
    '[class.single]': 'single()',
    '(document:keydown)': 'runShortcut($event)',
  },
})
export class App {
  // Applies the window-wide design settings, such as drawings on or off.
  protected readonly design = inject(DesignSettings);
  protected readonly service = inject(ServiceStatus);
  protected readonly list = inject(ChatList);
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly rightPage = inject(RightPageState);
  /** The page on the desk without the book's title bar, chat tabs and page tabs: in focus mode. */
  protected readonly bare = computed(() => this.focus.on());
  /**
   * The chat's page alone: in focus mode until the right
   * page is turned to the command palette, the approvals or a page
   * tab's page, which bring it back beside the chat while they show.
   */
  protected readonly single = computed(() => this.focus.on() && !this.rightPage.turned());
  /** The right page's own page lying alone in the chat's place in focus mode, if any. */
  protected readonly alonePage = computed(() => {
    const id = this.focus.alone();
    const page = this.focus.on() && id ? this.registry.rightPages.get(id) : undefined;
    return page?.load ? page : undefined;
  });
  /** Whether the command palette shows on this page: that of the chat on the right page. */
  protected readonly paletteHere = computed(() => {
    const search = this.rightPage.commandPalette();
    return !!search && search.chatId === this.list.besideId();
  });
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;

  constructor() {
    this.service.check();

    // While the service can't be reached, the page footer says so.
    effect((onCleanup) => {
      if (this.service.state() !== 'failed') return;
      const remove = this.registry.indicators.add({
        id: 'core.service',
        label: 'Background service unreachable',
        tone: 'alert',
        detail: this.service.error() ?? '',
        order: -1,
      });
      onCleanup(remove);
    });
  }

  protected runShortcut(event: KeyboardEvent): void {
    const command = this.registry.commands
      .all()
      .find(
        ({ run, shortcut }) => run && shortcut && matchesShortcut(event, shortcut, this.platform),
      );
    if (!command) return;
    event.preventDefault();
    command.run!();
  }
}
