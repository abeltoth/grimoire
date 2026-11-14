import { Injectable, inject, signal } from '@angular/core';
import type { AgentCommand, ApprovalMode, EffortLevel } from '@grimoire/contract';
import { ChatActions } from '../core/chat-actions';
import { ChatList } from '../core/chat-list';

/**
 * Runs a command from the command palette in a chat: sends it, writes it in
 * the chat's message field for you to finish, or, for what Grimoire keeps
 * itself, changes it through Grimoire.
 */
@Injectable({ providedIn: 'root' })
export class CommandRuns {
  private readonly list = inject(ChatList);
  private readonly actions = inject(ChatActions);

  /** A command to write in a chat's message field, until the chat's composer takes it. */
  readonly written = signal<{ chatId: string; text: string } | null>(null);
  /** The chat whose title is to be rewritten, until its page takes it. */
  readonly renaming = signal<string | null>(null);

  run(chatId: string, command: AgentCommand): void {
    if (command.owner === 'new-chat') {
      this.list.newChat();
      return;
    }
    if (command.owner === 'rename') {
      this.renaming.set(chatId);
      return;
    }
    const text = `/${command.name}`;
    if (command.run === 'compose') this.written.set({ chatId, text: `${text} ` });
    else void this.actions.send(chatId, text);
  }

  /** Runs a command with one of its choices. */
  pick(chatId: string, command: AgentCommand, value: string): void {
    if (command.owner === 'model') void this.actions.configure(chatId, { model: value });
    else if (command.owner === 'effort')
      void this.actions.configure(chatId, { effort: value as EffortLevel });
    else if (command.owner === 'mode')
      void this.actions.configure(chatId, { mode: value as ApprovalMode });
    else void this.actions.send(chatId, `/${command.name} ${value}`);
  }
}
