import { Component, PendingTasks, computed, effect, inject, input, signal } from '@angular/core';
import type { McpServerState } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import type { Chat } from '../core/chat';
import { ChatActions } from '../core/chat-actions';
import { McpServers } from '../core/mcp-servers';
import { Settings } from '../core/settings';
import { Wording } from '../core/wording';

interface Server {
  name: string;
  /** What it says of itself, in a few words. */
  status: string;
  /** Off in every chat, as Settings says: it stays off here. */
  everywhere: boolean;
  on: boolean;
  /** Whether it can be connected again: it's on in the chat's running process. */
  reconnects: boolean;
}

/**
 * The chat's MCP servers in the command palette: how each is in the
 * chat's running process, to connect one again, or to turn it off for
 * the chat or on again. Those off in every chat are in Settings.
 */
@Component({
  selector: 'gr-mcp-status',
  templateUrl: './mcp-status.html',
  styleUrl: './mcp-status.css',
  host: { role: 'group', 'aria-label': 'MCP servers' },
})
export class McpStatus {
  readonly chat = input.required<Chat>();
  /** What the command palette searches for: all of them for "mcp", or those it names. */
  readonly query = input('');

  protected readonly wording = inject(Wording);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly mcp = inject(McpServers);
  private readonly settings = inject(Settings);
  private readonly actions = inject(ChatActions);
  /** How they are in the chat's process; null while it isn't running, undefined until asked. */
  private readonly states = signal<McpServerState[] | null | undefined>(undefined);

  protected readonly servers = computed((): Server[] => {
    const { agent, settings } = this.chat();
    const listed = this.mcp.of(agent, settings.cwd) ?? [];
    const states = this.states();
    const everywhere = this.settings.all().mcpOff;
    const off = settings.mcpOff ?? [];
    const query = this.query().trim().toLowerCase();
    const names = [
      ...new Set([
        ...listed.map((server) => server.name),
        ...(states ?? []).map((state) => state.name),
        ...off,
      ]),
    ]
      .filter((name) => 'mcp'.startsWith(query) || name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
      const state = states?.find((s) => s.name === name);
      const on = !everywhere.includes(name) && !off.includes(name);
      return {
        name,
        status: this.statusOf(state, states, on, everywhere.includes(name)),
        everywhere: everywhere.includes(name),
        on,
        reconnects: on && !!state,
      };
    });
  });

  constructor() {
    effect(() => {
      const { agent, settings } = this.chat();
      this.mcp.load(agent, settings.cwd);
    });
    // Asked once for each chat, not again as its entries come.
    effect(() => void this.read(this.running()));
  }

  /** The chat's ID once it has begun; null for a blank one, which has no process yet. */
  private readonly running = computed(() =>
    this.chat().status === 'blank' ? null : this.chat().id,
  );

  protected async reconnect(name: string): Promise<void> {
    const chatId = this.chat().id;
    await this.bridge.invoke('agents.mcpReconnect', { chatId, name }).catch(() => {});
    await this.read(chatId);
  }

  /** Turns it off for the chat, or on again; the chat's process starts again to take it in. */
  protected toggle(server: Server): void {
    const chat = this.chat();
    const off = chat.settings.mcpOff ?? [];
    const mcpOff = server.on ? [...off, server.name] : off.filter((name) => name !== server.name);
    void this.actions.configure(chat.id, { mcpOff });
  }

  private async read(chatId: string | null): Promise<void> {
    if (chatId === null) return this.states.set(null);
    const done = this.pending.add();
    try {
      this.states.set(await this.bridge.invoke('agents.mcpStatus', { chatId }));
    } catch {
      this.states.set(null);
    } finally {
      done();
    }
  }

  private statusOf(
    state: McpServerState | undefined,
    states: McpServerState[] | null | undefined,
    on: boolean,
    everywhere: boolean,
  ): string {
    if (everywhere) return 'off in every chat';
    if (!on) return state ? 'off from the next start' : 'off';
    if (states === null) return this.wording.say('starts with the chapter', 'starts with the chat');
    if (!state) return states === undefined ? '' : 'on from the next start';
    switch (state.status) {
      case 'connected':
        return `connected · ${state.tools} ${state.tools === 1 ? 'tool' : 'tools'}`;
      case 'failed':
        return state.error ? `failed: ${state.error}` : 'failed';
      case 'needs-auth':
        return 'needs you to sign in';
      case 'pending':
        return 'connecting';
      case 'disabled':
        return 'disabled';
    }
  }
}
