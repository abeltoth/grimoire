import { NgComponentOutlet } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { DesignSettings } from '../design-system/design-settings';
import { GRIMOIRE_BRIDGE } from './core/bridge';
import { Chats } from './core/chats';
import { POPOUT } from './core/popout';
import { ServiceStatus } from './core/service-status';
import { Wording } from './core/wording';
import { Frame } from './shell/frame';
import { SlashCommands } from './shell/slash-commands';
import { RightPage } from './shell/right-page';
import { RightPageState } from './shell/right-page-state';
import { Focus } from './shell/focus';
import { Page } from './shell/page';
import { ChatTabs } from './shell/chat-tabs';
import { PageFooter } from './shell/page-footer';
import { ShellRegistry } from './shell/shell-registry';
import { matchesShortcut } from './shell/shortcut';
import { StatusIndicators } from './shell/status-indicators';
import { PageTabs } from './shell/page-tabs';
import { TitleBar } from './shell/title-bar';
import { WindowControls } from './shell/window-controls';

/**
 * The window: the title bar, and the open book on the desk with its
 * chat tabs. The left page shows the open chat through the page the chat
 * module registers, or the agent's commands while they're searched from
 * the chat on the right page. Registered commands run from their
 * shortcuts. In focus mode the chat's page lies alone in the middle of
 * the desk; so does a popout's, in a window of its own.
 */
@Component({
  selector: 'gr-root',
  imports: [
    Frame,
    SlashCommands,
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
  protected readonly chats = inject(Chats);
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly rightPage = inject(RightPageState);
  /** The chat this window holds as a popout; null in the book. */
  protected readonly popout = inject(POPOUT);
  /** The page on the desk without the book's title bar, chat tabs and page tabs: in focus mode, and in a popout. */
  protected readonly bare = computed(() => !!this.popout || this.focus.on());
  /**
   * The chat's page alone: in a popout, and in focus mode until the right
   * page is turned to the command palette, the agent's commands, the approvals or a page
   * tab's page, which bring it back beside the chat while they show.
   */
  protected readonly single = computed(
    () => !!this.popout || (this.focus.on() && !this.rightPage.turned()),
  );
  /** Whether the agent's commands show on this page: those searched from the chat on the right page. */
  protected readonly commandsHere = computed(() => {
    const search = this.rightPage.commands();
    return !!search && search.chatId === this.chats.besideId();
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

    // A popout's window is named for its chat, so you can tell it from the book.
    effect(() => {
      if (!this.popout) return;
      const title = this.chats.current()?.title || this.wording.untitled();
      document.title = `${title} · Grimoire`;
    });
  }

  protected runShortcut(event: KeyboardEvent): void {
    // The book's commands are the book's.
    if (this.popout) return;
    const command = this.registry.commands
      .all()
      .find(({ run, shortcut }) => run && shortcut && matchesShortcut(event, shortcut, this.platform));
    if (!command) return;
    event.preventDefault();
    command.run!();
  }
}
