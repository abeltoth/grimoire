import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { CommandGroup } from '@grimoire/contract';
import { Icon } from '../../design-system/icon';
import { AgentCatalog } from '../core/agent-catalog';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import { Wording } from '../core/wording';
import { AgentCommands, GROUPS, type ListedEntry } from './agent-commands';
import { Focus } from './focus';
import { McpStatus } from './mcp-status';
import { PageFooter } from './page/page-footer';
import { PageHeader } from './page/page-header';
import { ShellRegistry } from './shell-registry';
import { formatShortcut } from './shortcut';

interface Section {
  title: string;
  entries: ListedEntry[];
}

/**
 * The command palette: the chat's agent's commands and skills, by what
 * they do, and its MCP servers. Turned to with its shortcut or its tab, it
 * searches in a field of its own; turned to by "/" at the start of a
 * message, you keep typing in the message, whose keys move through the list.
 * A command runs at once, lists its choices to pick one, or is written in
 * the message for you to finish.
 */
@Component({
  selector: 'gr-command-palette',
  imports: [Icon, McpStatus, PageFooter, PageHeader],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class CommandPalette {
  /** The label of the page it turns back to. */
  readonly backTo = input.required<string>();
  /** With its page footer; not on a page that has one of its own. */
  readonly foot = input(true);

  protected readonly commands = inject(AgentCommands);
  protected readonly wording = inject(Wording);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly focus = inject(Focus);
  private readonly registry = inject(ShellRegistry);
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Searched for from a message, which keeps the keys. */
  protected readonly typed = computed(() => !!this.commands.search()?.typed);
  protected readonly query = computed(() => this.commands.search()?.query ?? '');
  protected readonly chat = this.commands.chat;
  protected readonly agentName = computed(() => {
    const chat = this.chat();
    return chat ? this.catalog.agentName(chat.agent) : '';
  });

  /** Where the commands run: the chat's title, or a new chat for a blank one. */
  protected readonly runsIn = computed(() => {
    const chat = this.chat();
    if (!chat || chat.status === 'blank') return this.wording.say('a new chapter', 'a new chat');
    return chat.title || this.wording.untitled();
  });

  protected readonly sections = computed<Section[]>(() => {
    const listed = this.commands.listed();
    const picking = this.commands.picking();
    const sections = picking
      ? [{ title: `/${picking.name}`, entries: listed }]
      : GROUPS.map((group) => ({
          title: this.title(group),
          entries: listed.filter((entry) => entry.command.group === group),
        }));
    return sections.filter((section) => section.entries.length);
  });

  /** Whether the MCP servers show: for an agent that says how they are, while no choice is picked. */
  protected readonly mcp = computed(() => {
    const chat = this.chat();
    return !!chat && !this.commands.picking() && this.catalog.can(chat.agent, 'mcp');
  });

  protected readonly count = computed(() => {
    const count = this.commands.listed().length;
    const [one, many] = this.wording.plain() ? ['result', 'results'] : ['entry', 'entries'];
    return `${count} ${count === 1 ? one : many}`;
  });

  /** Why nothing is listed. */
  protected readonly empty = computed(() => {
    const name = this.agentName();
    const picking = this.commands.picking();
    if (picking) return `Nothing /${picking.name} takes matches “${this.query()}”.`;
    const all = this.commands.all();
    if (!all) return `Asking ${name} for its commands and skills…`;
    if ('error' in all) return `${name}’s commands and skills couldn’t be listed: ${all.error}`;
    const written = this.typed() ? `/${this.query()}` : this.query();
    return `Nothing in ${name}’s commands and skills matches “${written}”.`;
  });

  protected readonly shortcutCaps = computed(() => {
    const shortcut = this.registry.commands.get('shell.commandPalette')?.shortcut;
    if (!shortcut) return [];
    const keys = formatShortcut(shortcut, this.platform, 'keys');
    return this.platform === 'mac' ? [...keys] : keys.split(' ');
  });

  constructor() {
    // Its own field takes the keys, again as it turns to a command's choices.
    afterRenderEffect(() => {
      this.commands.picking();
      if (!this.typed()) this.field()?.nativeElement.focus();
    });
    afterRenderEffect(() => {
      this.commands.selected();
      this.host
        .querySelector('.entry[aria-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** What the right-hand column says of an entry. */
  protected where(entry: ListedEntry): { text: string; folder?: true } {
    if (entry.choice) return { text: entry.choice.current ? 'set now' : '' };
    const { command } = entry;
    if (command.group === 'skills') return { text: 'skill' };
    const context = this.chat()?.context;
    if (command.name === 'compact' && context?.limit)
      return { text: `${Math.round((context.used / context.limit) * 100)}% used` };
    if (command.name === 'init')
      return { text: this.catalog.folderName(this.chat()?.settings.cwd), folder: true };
    if (command.run === 'pick') return { text: 'choose ›' };
    return { text: command.run === 'compose' ? 'write in' : 'run' };
  }

  protected key(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.commands.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = this.commands.chosen();
      if (chosen) this.commands.use(chosen);
    }
  }

  /** Esc turns back from a command's choices to the commands, and from there away. */
  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.commands.back();
  }

  private title(group: CommandGroup): string {
    switch (group) {
      case 'settings':
        return 'Settings';
      case 'reports':
        return 'Reports';
      case 'chat':
        return this.wording.say('This chapter', 'This chat');
      case 'skills':
        return `${this.agentName()}’s skills`;
    }
  }
}
