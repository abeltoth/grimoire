import { Component, inject } from '@angular/core';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';
import { Icon } from '@ui/design-system/icon';
import { Terminals } from './terminals';
import { TerminalSheet } from './terminal-sheet';

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The Terminal page: your shells, each on a tab of its own, written on the
 * page in the book's inks. A new one starts in the open chat's folder.
 */
@Component({
  selector: 'gr-terminal-page',
  imports: [Icon, TerminalSheet],
  templateUrl: './terminal-page.html',
  styleUrl: './terminal-page.css',
})
export class TerminalPage {
  protected readonly terminals = inject(Terminals);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);

  constructor() {
    void this.terminals.load();
  }

  protected time(at: number): string {
    return time(at);
  }
}
