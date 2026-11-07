import { Component, computed, inject, signal } from '@angular/core';
import type { Entry } from '@grimoire/contract';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { FacingTabs } from '@ui/app/shell/facing-tabs';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { RunningHead } from '@ui/app/shell/running-head';
import { HELPER_PAGE, Helpers } from './helpers';
import { Transcript } from './transcript';

/**
 * The facing page's Helper: what a subagent did with the task one of a
 * chapter's tool calls handed it, as it goes. It heads with the task, then
 * the helper's replies and tools as in a chapter, which only read. Until
 * you pick a helper in a chapter's margin, it says how to.
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
    return { description: text('description'), prompt: text('prompt'), kind: text('subagent_type') };
  });

  /** Who asked, in which chapter, and what kind of helper. */
  protected readonly meta = computed(() => {
    const chapter = this.helpers.chapter();
    if (!chapter) return '';
    const parts = [
      `${this.wording.say('Asked by', 'Started by')} ${this.chats.agentName(chapter.agent)}`,
      chapter.title || this.wording.untitled(),
      this.task().kind,
    ];
    return parts.filter(Boolean).join(' · ');
  });

  /** Whether the task's prompt is folded out. */
  protected readonly reading = signal(false);

  /** The helper's run as a chapter that only reads; its result alone when there's no record of it. */
  protected readonly run = computed<Chapter | undefined>(() => {
    const chapter = this.helpers.chapter();
    const block = this.helpers.block();
    if (!chapter || !block) return undefined;
    let entries: readonly Entry[] = this.helpers.entries();
    if (!entries.length && block.result?.text && !this.helpers.loading())
      entries = [{ kind: 'agent', id: `${block.id}/result`, blocks: [{ kind: 'text', text: block.result.text }] }];
    return {
      id: chapter.id,
      agent: chapter.agent,
      title: chapter.title,
      settings: chapter.settings,
      status: this.helpers.running() ? 'thinking' : 'idle',
      entries,
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      dogEars: [],
      tags: [],
      copied: [],
    };
  });

  /** What the foot says of the helper: working, failed or done. */
  protected readonly state = computed(() => {
    const block = this.helpers.block();
    if (!block) return '';
    if (this.helpers.running()) return this.wording.say('Working…', 'Running…');
    if (block.result?.isError) return 'Failed';
    return block.result ? 'Done' : 'Stopped';
  });
}
