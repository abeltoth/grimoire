import { Component, inject } from '@angular/core';
import { Chats } from '@ui/app/core/chats';
import { Icon } from '@ui/design-system/icon';
import { Scriptorium } from './scriptorium';
import { TerminalSheet } from './terminal-sheet';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The Scriptorium: your shells, each on a tab of its own, written on the
 * page in the book's inks. A new one starts in the open chapter's folder.
 */
@Component({
  selector: 'gr-scriptorium-page',
  imports: [Icon, TerminalSheet],
  templateUrl: './scriptorium-page.html',
  styleUrl: './scriptorium-page.css',
})
export class ScriptoriumPage {
  protected readonly scriptorium = inject(Scriptorium);
  protected readonly chats = inject(Chats);

  constructor() {
    void this.scriptorium.load();
  }

  protected time(at: number): string {
    return time(at);
  }
}
