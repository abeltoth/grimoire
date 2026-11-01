import { Component, inject } from '@angular/core';
import { DesignSettings } from '../design-system/design-settings';
import { ServiceStatus } from './core/service-status';
import { Book } from './shell/book';
import { FacingPage } from './shell/facing-page';
import { OpenChapters } from './shell/open-chapters';
import { Page } from './shell/page';
import { Ribbons } from './shell/ribbons';
import { RunningFoot } from './shell/running-foot';
import { StatusIndicators } from './shell/status-indicators';
import { ThumbIndex } from './shell/thumb-index';
import { TitleStrip } from './shell/title-strip';

/**
 * The window: the title strip, and the open book on the desk with its
 * ribbons. The chapter on the left page arrives with the chat (phase 5).
 */
@Component({
  selector: 'gr-root',
  imports: [Book, FacingPage, Page, Ribbons, RunningFoot, StatusIndicators, ThumbIndex, TitleStrip],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '[attr.data-service-state]': 'service.state()' },
})
export class App {
  // Applies the window-wide design settings, such as drawings on or off.
  protected readonly design = inject(DesignSettings);
  protected readonly service = inject(ServiceStatus);
  protected readonly chapters = inject(OpenChapters);

  // Mock until profiles exist.
  protected readonly profile = 'Work';

  constructor() {
    this.service.check();
  }
}
