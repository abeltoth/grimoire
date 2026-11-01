import { NgComponentOutlet } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { DesignSettings } from '../design-system/design-settings';
import { Chats } from './core/chats';
import { ServiceStatus } from './core/service-status';
import { Book } from './shell/book';
import { FacingPage } from './shell/facing-page';
import { Page } from './shell/page';
import { Ribbons } from './shell/ribbons';
import { RunningFoot } from './shell/running-foot';
import { ShellRegistry } from './shell/shell-registry';
import { StatusIndicators } from './shell/status-indicators';
import { ThumbIndex } from './shell/thumb-index';
import { TitleStrip } from './shell/title-strip';

/**
 * The window: the title strip, and the open book on the desk with its
 * ribbons. The left page shows the open chapter through the page the chat
 * module registers.
 */
@Component({
  selector: 'gr-root',
  imports: [
    Book,
    FacingPage,
    NgComponentOutlet,
    Page,
    Ribbons,
    RunningFoot,
    StatusIndicators,
    ThumbIndex,
    TitleStrip,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '[attr.data-service-state]': 'service.state()' },
})
export class App {
  // Applies the window-wide design settings, such as drawings on or off.
  protected readonly design = inject(DesignSettings);
  protected readonly service = inject(ServiceStatus);
  protected readonly chapters = inject(Chats);
  protected readonly registry = inject(ShellRegistry);

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
  }
}
