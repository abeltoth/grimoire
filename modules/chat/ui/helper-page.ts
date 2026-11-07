import { Component, computed, inject } from '@angular/core';
import type { Entry } from '@grimoire/contract';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { modelLabel } from '@ui/app/core/tokens';
import { Wording } from '@ui/app/core/wording';
import { FacingTabs } from '@ui/app/shell/facing-tabs';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { RunningHead } from '@ui/app/shell/running-head';
import { HELPER_PAGE, Helpers } from './helpers';
import { Transcript } from './transcript';

/**
 * The facing page's Helper: what a subagent did with the task one of a
 * chapter's tool calls handed it, as it goes. It heads with what the task
 * is for, the kind of helper, its model and where it is with the task;
 * then reads as a chapter that only reads: the task, signed by who asked,
 * the helper's replies and tools, and the report it hands back. Until you
 * pick a helper in a chapter's margin, it says how to.
 */
@Component({
  selector: 'gr-helper-page',
  imports: [FacingTabs, RunningFoot, RunningHead, Transcript],
  templateUrl: './helper-page.html',
  styleUrl: './helper-page.css',
})
export class HelperPage {
  protected readonly helpers = inject(Helpers);
  protected readonly wording = inject(Wording);
  private readonly chats = inject(Chats);
  protected readonly page = HELPER_PAGE;

  /** The task as the tool call gave it. */
  protected readonly task = computed(() => {
    const input = (this.helpers.block()?.input ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
    return {
      description: text('description'),
      prompt: text('prompt'),
      kind: text('subagent_type'),
      model: text('model'),
    };
  });

  /** The model the helper works on: the one its last reply names, else the one it was asked to. */
  protected readonly model = computed(() => {
    const models = this.helpers
      .entries()
      .flatMap((entry) => (entry.kind === 'agent' && entry.model ? [entry.model] : []));
    const model = models.at(-1) || this.task().model;
    return model ? modelLabel(model) : '';
  });

  /** What kind of helper, its model, and where it is with its task. */
  protected readonly meta = computed(() =>
    [this.task().kind, this.model(), this.state()].filter(Boolean).join(' · '),
  );

  /** Who asked: the chapter's agent, or the helper that started this one. */
  protected readonly askedBy = computed(() => {
    const chapter = this.helpers.chapter();
    const toolId = this.helpers.block()?.id;
    const own = chapter?.entries.some(
      (entry) => entry.kind === 'agent' && entry.blocks.some((b) => b.kind === 'tool' && b.id === toolId),
    );
    return chapter && own ? this.chats.agentName(chapter.agent) : this.wording.say('Helper', 'Subagent');
  });

  /** Whether there's nothing of what the helper did to read, as yet or at all. */
  protected readonly unrecorded = computed(() => !this.helpers.loading() && !this.helpers.entries().length);

  /**
   * The helper's run as a chapter that only reads: its task first, then what
   * it did; its tool call's result alone when there's no record of that.
   */
  protected readonly run = computed<Chapter | undefined>(() => {
    const chapter = this.helpers.chapter();
    const block = this.helpers.block();
    if (!chapter || !block) return undefined;
    let entries: readonly Entry[] = this.helpers.entries();
    if (this.unrecorded() && block.result?.text && !this.helpers.running())
      entries = [
        { kind: 'agent', id: `${block.id}/result`, blocks: [{ kind: 'text', text: block.result.text }] },
      ];
    const prompt = this.task().prompt;
    return {
      id: chapter.id,
      agent: chapter.agent,
      title: chapter.title,
      settings: chapter.settings,
      status: this.helpers.running() ? 'thinking' : 'idle',
      entries: prompt ? [{ kind: 'user', id: `${block.id}/task`, text: prompt }, ...entries] : [...entries],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    };
  });

  /** Where the helper is with its task: working, done, failed or stopped. */
  protected readonly state = computed(() => {
    switch (this.helpers.state()) {
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
