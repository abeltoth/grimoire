import { Component, ElementRef, afterRenderEffect, computed, inject, input } from '@angular/core';
import type { AgentCommand } from '@grimoire/contract';
import { Icon } from '../../design-system/icon';
import { ChatList } from '../core/chat-list';
import { AgentCatalog } from '../core/agent-catalog';
import { Wording } from '../core/wording';
import { AgentCommands, type ListedCommand } from './agent-commands';
import { PageFooter } from './page/page-footer';
import { PageHeader } from './page/page-header';

interface Section {
  title: string;
  entries: ListedCommand[];
}

/**
 * The slash commands, turned to by "/" at the start of a message: the chat's agent's
 * commands and skills. You keep typing in the message field to narrow them; its keys
 * move through them, and a click uses one.
 */
@Component({
  selector: 'gr-slash-commands',
  imports: [Icon, PageFooter, PageHeader],
  templateUrl: './slash-commands.html',
  styleUrls: ['./command-palette.css', './slash-commands.css'],
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class SlashCommands {
  /** The label of the page it turns back to. */
  readonly backTo = input.required<string>();
  /** With its page footer; not on a page that has one of its own. */
  readonly foot = input(true);

  protected readonly commands = inject(AgentCommands);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly agentName = computed(() => {
    const search = this.commands.search();
    return search ? this.catalog.agentName(search.agent) : '';
  });

  protected readonly sections = computed<Section[]>(() => {
    const listed = this.commands.listed();
    const sections: Section[] = [
      {
        title: `${this.agentName()}’s commands`,
        entries: listed.filter((c) => c.kind === 'command'),
      },
      { title: `${this.agentName()}’s skills`, entries: listed.filter((c) => c.kind === 'skill') },
    ];
    return sections.filter((section) => section.entries.length);
  });

  protected readonly count = computed(() => {
    const count = this.commands.listed().length;
    const [one, many] = this.wording.plain() ? ['result', 'results'] : ['entry', 'entries'];
    return `${count} ${count === 1 ? one : many}`;
  });

  /** Why nothing is listed. */
  protected readonly empty = computed(() => {
    const all = this.commands.all();
    const name = this.agentName();
    if (!all) return `Asking ${name} for its commands and skills…`;
    if ('error' in all) return `${name}’s commands and skills couldn’t be listed: ${all.error}`;
    return `Nothing in ${name}’s commands and skills matches “/${this.commands.search()?.query}”.`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.commands.selected();
      this.host
        .querySelector('.entry[aria-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** What the right-hand column says: how full the chat is for /compact, its folder for /init. */
  protected where(command: AgentCommand): { text: string; folder?: true } {
    if (command.kind === 'skill') return { text: 'skill' };
    const search = this.commands.search();
    const context = this.list.all().find((chat) => chat.id === search?.chatId)?.context;
    if (command.name === 'compact' && context?.limit)
      return { text: `${Math.round((context.used / context.limit) * 100)}% used` };
    if (command.name === 'init')
      return { text: this.catalog.folderName(search?.cwd), folder: true };
    return { text: 'command' };
  }

  protected use(command: AgentCommand): void {
    this.commands.search()?.use(command);
  }

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.commands.close();
  }
}
