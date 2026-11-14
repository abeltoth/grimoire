import { Injectable, PendingTasks, computed, inject, linkedSignal, signal } from '@angular/core';
import type { AgentCommand, AgentId, CommandGroup } from '@grimoire/contract';
import { AgentCatalog } from '../core/agent-catalog';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import type { Chat } from '../core/chat';
import { ChatList } from '../core/chat-list';
import { type Choice, choicesOf } from './command-choices';
import { CommandRuns } from './command-runs';
import { type CommandSearch, RightPageState } from './right-page/right-page-state';

/** The groups, in the order the command palette lists them. */
export const GROUPS: readonly CommandGroup[] = ['settings', 'reports', 'chat'];

/** A command, or one of the choices of the command being picked, as the command palette lists it. */
export interface ListedEntry {
  /** Its ID among those listed. */
  id: string;
  /** Split around what you searched for. */
  parts: [before: string, match: string, after: string];
  command: AgentCommand;
  /** The choice, while one is picked for the command. */
  choice?: Choice;
}

/** An agent's commands for a folder, or why they couldn't be listed. */
type Loaded = { commands: AgentCommand[] } | { error: string };

/**
 * The command palette's list: the chat's agent's commands,
 * searched in the command palette or from the start of a message after a
 * "/", and the choices of a command that takes one. Its keys move through
 * them, and use one.
 */
@Injectable({ providedIn: 'root' })
export class AgentCommands {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly rightPage = inject(RightPageState);
  private readonly pending = inject(PendingTasks);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly runs = inject(CommandRuns);
  private readonly loaded = signal<Readonly<Record<string, Loaded>>>({});

  /** What's searched for; null while the command palette doesn't show. */
  readonly search = this.rightPage.commandPalette.asReadonly();
  /** The chat the commands run in. */
  readonly chat = computed(() => {
    const id = this.search()?.chatId;
    return id === undefined ? undefined : this.list.all().find((chat) => chat.id === id);
  });
  /** The command whose choices are listed, until one is picked. */
  readonly picking = signal<AgentCommand | null>(null);

  /** The commands for the chat's folder; undefined while they're asked for. */
  readonly all = computed(() => {
    const chat = this.chat();
    return chat ? this.loaded()[key(chat.agent, chat.settings.cwd)] : undefined;
  });

  /** The commands, group by group, or the choices, whose name holds what's searched for. */
  readonly listed = computed<ListedEntry[]>(() => {
    const query = this.search()?.query ?? '';
    const chat = this.chat();
    const picking = this.picking();
    if (!chat) return [];
    if (picking) return this.choices(picking, chat, query);
    const all = this.all();
    if (!all || !('commands' in all)) return [];
    return GROUPS.flatMap((group) =>
      narrow(
        all.commands.filter((command) => command.group === group),
        query,
      ),
    );
  });

  /** The ID of the entry Enter uses; the first listed until you move. */
  readonly selected = linkedSignal({
    source: this.listed,
    computation: (listed: ListedEntry[]) => listed[0]?.id,
  });
  readonly chosen = computed(() => this.listed().find((entry) => entry.id === this.selected()));

  /** Shows the command palette, asking the agent for its commands when they're new. */
  open(search: CommandSearch): void {
    const was = this.chat();
    this.picking.set(null);
    this.rightPage.openCommandPalette(search);
    const chat = this.chat();
    if (chat && (!was || keyOf(was) !== keyOf(chat)))
      this.pending.run(() => this.load(chat.agent, chat.settings.cwd));
  }

  /** The command palette for the chat you're on, from its shortcut or its tab. */
  openPalette(): void {
    const chatId = this.list.currentId() ?? this.list.newChat();
    this.open({ chatId, query: '', typed: false });
  }

  /** Searches for this instead, in the command palette's own field. */
  searchFor(query: string): void {
    const search = this.search();
    if (search) this.rightPage.commandPalette.set({ ...search, query });
  }

  close(): void {
    this.picking.set(null);
    this.rightPage.closeCommandPalette();
  }

  /** Back from the choices to the commands, or else away from the command palette. */
  back(): void {
    if (!this.picking()) return this.close();
    this.picking.set(null);
    this.searchFor('');
  }

  move(step: number): void {
    const listed = this.listed();
    const at = listed.findIndex((entry) => entry.id === this.selected());
    const next = listed[Math.min(Math.max(at + step, 0), listed.length - 1)];
    if (next) this.selected.set(next.id);
  }

  /**
   * Uses an entry: runs the command or picks the choice, or lists the
   * command's choices, in the command palette's own field when it was
   * searched for from a message.
   */
  use(entry: ListedEntry): void {
    const search = this.search();
    if (!search) return;
    const { chatId } = search;
    if (entry.choice) {
      this.close();
      return this.runs.pick(chatId, entry.command, entry.choice.value);
    }
    if (entry.command.run === 'pick') {
      this.rightPage.openCommandPalette({ chatId, query: '', typed: false });
      this.picking.set(entry.command);
      return;
    }
    this.close();
    this.runs.run(chatId, entry.command);
  }

  private choices(command: AgentCommand, chat: Chat, query: string): ListedEntry[] {
    const choices = choicesOf(
      command,
      chat,
      this.catalog.models()[chat.agent],
      this.catalog.effortOf(chat.agent, chat.settings),
    );
    return choices.flatMap((choice): ListedEntry[] => {
      const parts = split(choice.label, query);
      return parts ? [{ id: `${command.name}-${choice.value}`, parts, command, choice }] : [];
    });
  }

  private async load(agent: AgentId, cwd: string | undefined): Promise<void> {
    const at = key(agent, cwd);
    try {
      const commands = await this.bridge.invoke('agents.commands', {
        agent,
        ...(cwd ? { cwd } : {}),
      });
      this.loaded.update((loaded) => ({ ...loaded, [at]: { commands: commands ?? [] } }));
    } catch (error) {
      // A list you already have stays when asking again fails.
      this.loaded.update((loaded) =>
        loaded[at] && 'commands' in loaded[at]
          ? loaded
          : { ...loaded, [at]: { error: error instanceof Error ? error.message : String(error) } },
      );
    }
  }
}

function key(agent: AgentId, cwd: string | undefined): string {
  return `${agent}\n${cwd ?? ''}`;
}

function keyOf(chat: Chat): string {
  return key(chat.agent, chat.settings.cwd);
}

/** The commands whose name holds the query, those starting with it first. */
function narrow(commands: AgentCommand[], query: string): ListedEntry[] {
  const found = commands.flatMap((command): ListedEntry[] => {
    // Commands are written with their "/"; it's part of what you searched for when the name starts with it.
    const shown = `/${command.name}`;
    const at = command.name.toLowerCase().indexOf(query.toLowerCase());
    if (at === -1) return [];
    const from = at === 0 ? 0 : at + 1;
    const end = at + 1 + query.length;
    const parts: ListedEntry['parts'] = [
      shown.slice(0, from),
      shown.slice(from, end),
      shown.slice(end),
    ];
    return [{ id: command.name, parts, command }];
  });
  return found.sort((a, b) => Number(a.parts[0] !== '') - Number(b.parts[0] !== ''));
}

/** The label split around the query; undefined when it doesn't hold it. */
function split(label: string, query: string): ListedEntry['parts'] | undefined {
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return undefined;
  const end = at + query.length;
  return [label.slice(0, at), label.slice(at, end), label.slice(end)];
}
