import { Injectable, PendingTasks, computed, inject, linkedSignal, signal } from '@angular/core';
import type { AgentCommand } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import { type CommandSearch, RightPageState } from './right-page-state';

/** A command as listed: its name as you'd write it, split around what you searched for. */
export interface ListedCommand extends AgentCommand {
  parts: [before: string, match: string, after: string];
}

/** An agent's commands for a folder, or why they couldn't be listed. */
type Loaded = { commands: AgentCommand[] } | { error: string };

/**
 * An agent's commands and skills, searched from the start of a message: the
 * entry asks for them as you write "/", the right page lists them, and
 * the message field's keys move through them and use one.
 */
@Injectable({ providedIn: 'root' })
export class AgentCommands {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly rightPage = inject(RightPageState);
  private readonly pending = inject(PendingTasks);
  private readonly loaded = signal<Readonly<Record<string, Loaded>>>({});

  /** What's being searched for; null when the right page doesn't show it. */
  readonly search = this.rightPage.commands.asReadonly();

  /** The commands for the folder searched from; undefined while they're asked for. */
  readonly all = computed(() => {
    const search = this.search();
    return search ? this.loaded()[key(search)] : undefined;
  });

  /** The commands, then the skills, whose name holds what follows the "/". */
  readonly listed = computed<ListedCommand[]>(() => {
    const search = this.search();
    const all = this.all();
    if (!search || !all || !('commands' in all)) return [];
    return [
      ...narrow(all.commands, 'command', search.query),
      ...narrow(all.commands, 'skill', search.query),
    ];
  });

  /** The name of the command Enter uses; the first listed until you move. */
  readonly selected = linkedSignal({
    source: this.listed,
    computation: (listed: ListedCommand[]) => listed[0]?.name,
  });
  readonly chosen = computed(() =>
    this.listed().find((command) => command.name === this.selected()),
  );

  /** Turns the right page to the commands, asking the agent for them when they're new. */
  open(search: CommandSearch): void {
    const was = this.search();
    this.rightPage.openCommands(search);
    if (!was || key(was) !== key(search)) this.pending.run(() => this.load(search));
  }

  close(): void {
    this.rightPage.closeCommands();
  }

  move(step: number): void {
    const listed = this.listed();
    const at = listed.findIndex((command) => command.name === this.selected());
    const next = listed[Math.min(Math.max(at + step, 0), listed.length - 1)];
    if (next) this.selected.set(next.name);
  }

  private async load(search: CommandSearch): Promise<void> {
    const at = key(search);
    try {
      const commands = await this.bridge.invoke('agents.commands', {
        agent: search.agent,
        ...(search.cwd ? { cwd: search.cwd } : {}),
      });
      this.loaded.update((loaded) => ({ ...loaded, [at]: { commands } }));
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

function key({ agent, cwd }: CommandSearch): string {
  return `${agent}\n${cwd ?? ''}`;
}

/** One kind's commands whose name holds the query, those starting with it first. */
function narrow(
  commands: AgentCommand[],
  kind: AgentCommand['kind'],
  query: string,
): ListedCommand[] {
  const needle = query.toLowerCase();
  const found = commands.flatMap((command): ListedCommand[] => {
    if (command.kind !== kind) return [];
    const at = command.name.toLowerCase().indexOf(needle);
    if (at === -1) return [];
    // Commands are written with their "/"; it's part of what you searched for when the name starts with it.
    const shown = kind === 'command' ? `/${command.name}` : command.name;
    const lead = shown.length - command.name.length;
    const from = at === 0 ? 0 : at + lead;
    const end = at + lead + needle.length;
    return [
      { ...command, parts: [shown.slice(0, from), shown.slice(from, end), shown.slice(end)] },
    ];
  });
  return found.sort((a, b) => Number(a.parts[0] !== '') - Number(b.parts[0] !== ''));
}
