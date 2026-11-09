import { Component, computed, inject } from '@angular/core';
import type { Entry } from '@grimoire/contract';
import { type Chat, Chats } from '@ui/app/core/chats';
import { modelLabel } from '@ui/app/core/tokens';
import { Wording } from '@ui/app/core/wording';
import { RightPageTabs } from '@ui/app/shell/right-page-tabs';
import { PageFooter } from '@ui/app/shell/page-footer';
import { PageHeader } from '@ui/app/shell/page-header';
import { SUBAGENT_PAGE, Subagents } from './subagents';
import { Transcript } from './transcript';

/**
 * The right page's Subagent: what a subagent did with the task one of a
 * chat's tool calls handed it, as it goes. It heads with what the task
 * is for, the kind of subagent, its model and where it is with the task;
 * then reads as a chat that only reads: the task, signed by who asked,
 * the subagent's replies and tools, and the report it hands back. Until you
 * pick a subagent in a chat's margin, it says how to.
 */
@Component({
  selector: 'gr-subagent-page',
  imports: [RightPageTabs, PageFooter, PageHeader, Transcript],
  templateUrl: './subagent-page.html',
  styleUrl: './subagent-page.css',
})
export class SubagentPage {
  protected readonly subagents = inject(Subagents);
  protected readonly wording = inject(Wording);
  private readonly chats = inject(Chats);
  protected readonly page = SUBAGENT_PAGE;

  /** The task as the tool call gave it. */
  protected readonly task = computed(() => {
    const input = (this.subagents.block()?.input ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
    return {
      description: text('description') || text('summary'),
      prompt: text('prompt') || text('message'),
      kind: text('subagent_type'),
      model: text('model'),
    };
  });

  /** The model the subagent works on: the one its last reply names, else the one it was asked to. */
  protected readonly model = computed(() => {
    const models = this.subagents
      .entries()
      .flatMap((entry) => (entry.kind === 'agent' && entry.model ? [entry.model] : []));
    const model = models.at(-1) || this.task().model;
    return model ? modelLabel(model) : '';
  });

  /** What kind of subagent, its model, and where it is with its task. */
  protected readonly meta = computed(() =>
    [this.task().kind, this.model(), this.state()].filter(Boolean).join(' · '),
  );

  /** Who asked: the chat's agent, or the subagent that started this one. */
  protected readonly askedBy = computed(() => {
    const chat = this.subagents.chat();
    const toolId = this.subagents.block()?.id;
    const own = chat?.entries.some(
      (entry) => entry.kind === 'agent' && entry.blocks.some((b) => b.kind === 'tool' && b.id === toolId),
    );
    return chat && own ? this.chats.agentName(chat.agent) : this.wording.say('Helper', 'Subagent');
  });

  /** Whether there's nothing of what the subagent did to read, as yet or at all. */
  protected readonly unrecorded = computed(() => !this.subagents.loading() && !this.subagents.entries().length);

  /**
   * The subagent's run as a chat that only reads: its task first, then what
   * it did; its tool call's result alone when there's no record of that. A
   * run a message resumed holds its own task and the messages it was sent.
   */
  protected readonly run = computed<Chat | undefined>(() => {
    const chat = this.subagents.chat();
    const block = this.subagents.block();
    if (!chat || !block) return undefined;
    let entries: readonly Entry[] = this.subagents.entries();
    // A message's result only says it was sent.
    if (this.unrecorded() && block.result?.text && !this.subagents.running() && block.tool !== 'SendMessage')
      entries = [
        { kind: 'agent', id: `${block.id}/result`, blocks: [{ kind: 'text', text: block.result.text }] },
      ];
    const prompt = entries.some((entry) => entry.kind === 'user') ? '' : this.task().prompt;
    return {
      id: chat.id,
      agent: chat.agent,
      title: chat.title,
      settings: chat.settings,
      status: this.subagents.running() ? 'thinking' : 'idle',
      entries: prompt ? [{ kind: 'user', id: `${block.id}/task`, text: prompt }, ...entries] : [...entries],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    };
  });

  /** Where the subagent is with its task: working, done, failed or stopped. */
  protected readonly state = computed(() => {
    switch (this.subagents.state()) {
      case 'working':
        return this.wording.say('Working…', 'Running…');
      case 'done':
        return 'Done';
      case 'failed':
        return 'Failed';
      case 'stopped':
        return 'Stopped';
      default:
        return '';
    }
  });
}
