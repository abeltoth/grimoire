import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
} from '@angular/core';
import type { AgentCommand } from '@grimoire/contract';
import { Icon } from '../../design-system/icon';
import { Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { AgentCommands, type ListedCommand } from './agent-commands';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';

interface Section {
  title: string;
  entries: ListedCommand[];
}

/**
 * The Index turned to by "/" at the start of an entry: the chapter's agent's
 * commands and skills. You keep typing in the entry to narrow them; its keys
 * move through them, and a click uses one.
 */
@Component({
  selector: 'gr-command-index',
  imports: [Icon, RunningFoot, RunningHead],
  templateUrl: './command-index.html',
  styleUrls: ['./index-page.css', './command-index.css'],
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class CommandIndex {
  /** The label of the page it turns back to. */
  readonly backTo = input('facing page');

  protected readonly commands = inject(AgentCommands);
  private readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly agentName = computed(() => {
    const lookUp = this.commands.lookUp();
    return lookUp ? this.chats.agentName(lookUp.agent) : '';
  });

  protected readonly sections = computed<Section[]>(() => {
    const listed = this.commands.listed();
    const sections: Section[] = [
      { title: `${this.agentName()}’s commands`, entries: listed.filter((c) => c.kind === 'command') },
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
    return `Nothing in ${name}’s commands and skills matches “/${this.commands.lookUp()?.query}”.`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.commands.selected();
      this.host.querySelector('.entry[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** What the right-hand column says: how full the chapter is for /compact, its folder for /init. */
  protected where(command: AgentCommand): { text: string; folder?: true } {
    if (command.kind === 'skill') return { text: 'skill' };
    const lookUp = this.commands.lookUp();
    const context = this.chats.current()?.context;
    if (command.name === 'compact' && context?.limit)
      return { text: `${Math.round((context.used / context.limit) * 100)}% used` };
    if (command.name === 'init') return { text: this.chats.folderName(lookUp?.cwd), folder: true };
    return { text: 'command' };
  }

  protected use(command: AgentCommand): void {
    this.commands.lookUp()?.use(command);
  }

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.commands.close();
  }
}
