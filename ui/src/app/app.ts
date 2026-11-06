import { NgComponentOutlet } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { DesignSettings } from '../design-system/design-settings';
import { GRIMOIRE_BRIDGE } from './core/bridge';
import { Chats } from './core/chats';
import { LEAF } from './core/leaf';
import { ServiceStatus } from './core/service-status';
import { Wording } from './core/wording';
import { Book } from './shell/book';
import { CommandIndex } from './shell/command-index';
import { FacingPage } from './shell/facing-page';
import { Facing } from './shell/facing';
import { Focus } from './shell/focus';
import { Page } from './shell/page';
import { Ribbons } from './shell/ribbons';
import { RunningFoot } from './shell/running-foot';
import { ShellRegistry } from './shell/shell-registry';
import { matchesShortcut } from './shell/shortcut';
import { StatusIndicators } from './shell/status-indicators';
import { ThumbIndex } from './shell/thumb-index';
import { TitleStrip } from './shell/title-strip';
import { WindowControls } from './shell/window-controls';

/**
 * The window: the title strip, and the open book on the desk with its
 * ribbons. The left page shows the open chapter through the page the chat
 * module registers, or the agent's commands while they're looked up from
 * the chapter on the facing page. Registered commands run from their
 * shortcuts. In focus mode the chapter's page lies alone in the middle of
 * the desk; so does a loose leaf's, in a window of its own.
 */
@Component({
  selector: 'gr-root',
  imports: [
    Book,
    CommandIndex,
    FacingPage,
    NgComponentOutlet,
    Page,
    Ribbons,
    RunningFoot,
    StatusIndicators,
    ThumbIndex,
    TitleStrip,
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
  protected readonly chapters = inject(Chats);
  protected readonly registry = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly facing = inject(Facing);
  /** The chapter this window holds as a loose leaf; null in the book. */
  protected readonly leaf = inject(LEAF);
  /** The page on the desk without the book's title strip, ribbons and thumb tabs: in focus mode, and in a leaf. */
  protected readonly bare = computed(() => !!this.leaf || this.focus.on());
  /**
   * The chapter's page alone: in a leaf, and in focus mode until the facing
   * page is turned to the Index, the agent's commands, the seals or a thumb
   * tab's page, which bring it back beside the chapter while they show.
   */
  protected readonly single = computed(
    () => !!this.leaf || (this.focus.on() && !this.facing.turned()),
  );
  /** Whether the agent's commands show on this page: those looked up from the chapter on the facing page. */
  protected readonly commandsHere = computed(() => {
    const lookUp = this.facing.commands();
    return !!lookUp && lookUp.chapterId === this.chapters.besideId();
  });
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;

  // Mock until profiles exist.
  protected readonly profile = 'Work';

  constructor() {
    this.service.check();

    // While the service can't be reached, the running foot says so.
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

    // A loose leaf's window is named for its chapter, so you can tell it from the book.
    effect(() => {
      if (!this.leaf) return;
      const title = this.chapters.current()?.title || this.wording.untitled();
      document.title = `${title} · Grimoire`;
    });
  }

  protected runShortcut(event: KeyboardEvent): void {
    // The book's commands are the book's.
    if (this.leaf) return;
    const command = this.registry.commands
      .all()
      .find(({ run, shortcut }) => run && shortcut && matchesShortcut(event, shortcut, this.platform));
    if (!command) return;
    event.preventDefault();
    command.run!();
  }
}
