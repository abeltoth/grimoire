import { Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import type { AgentId, EffortLevel, ScheduleDraft, ScheduleInfo } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { EFFORTS } from '@ui/app/core/efforts';
import { ScheduledChats } from './scheduled-chats';
import { WEEK } from './wording';

const RECENT_FOLDERS = 3;
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * A schedule written out to save: its name, the entry each run begins
 * with, its days and time, and the chat's folder, model and effort.
 * Its permission is always Full access, so it says so instead of asking.
 */
@Component({
  selector: 'gr-schedule-form',
  templateUrl: './schedule-form.html',
  styleUrl: './schedule-form.css',
})
export class ScheduleForm {
  /** The schedule changed; a new one when left out. */
  readonly schedule = input<ScheduleInfo>();
  /** Saved, or put away. */
  readonly done = output<void>();

  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly scheduled = inject(ScheduledChats);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly week = WEEK;

  // Written out from the schedule changed; a new one from the chat you're on.
  protected readonly name = linkedSignal(() => this.schedule()?.name ?? '');
  protected readonly prompt = linkedSignal(() => this.schedule()?.prompt ?? '');
  protected readonly days = linkedSignal<ReadonlySet<number>>(() => new Set(this.schedule()?.days ?? WEEKDAYS));
  protected readonly time = linkedSignal(() => this.schedule()?.time ?? '08:00');
  protected readonly agent = linkedSignal<AgentId>(
    () =>
      this.schedule()?.agent ??
      untracked(() => this.chats.current()?.agent ?? this.chats.agents()[0]?.id ?? 'claude-code'),
  );
  protected readonly cwd = linkedSignal<string | undefined>(() => {
    const schedule = this.schedule();
    return schedule ? schedule.settings.cwd : untracked(() => this.chats.current()?.settings.cwd);
  });
  protected readonly model = linkedSignal<string | undefined>(() => this.schedule()?.settings.model);
  protected readonly effort = linkedSignal<EffortLevel | undefined>(() => this.schedule()?.settings.effort);
  protected readonly saving = signal(false);

  protected readonly folders = computed(() => {
    const current = this.cwd() ?? this.chats.folders().home;
    const others = this.chats.folders().recent.filter((cwd) => cwd !== current);
    return [...(current ? [current] : []), ...others].slice(0, RECENT_FOLDERS);
  });
  protected readonly models = computed(() => this.chats.models()[this.agent()]);
  protected readonly selectedModel = computed(() => this.model() ?? this.models()?.default);
  protected readonly efforts = computed(() => {
    const { levels, level } = this.chats.effortOf(this.agent(), { model: this.selectedModel(), effort: this.effort() });
    return { choices: EFFORTS.filter((e) => levels.includes(e.level)), level };
  });
  protected readonly complete = computed(
    () => !!this.name().trim() && !!this.prompt().trim() && this.days().size > 0 && !!this.time(),
  );

  protected toggleDay(day: number): void {
    this.days.update((days) => {
      const next = new Set(days);
      if (!next.delete(day)) next.add(day);
      return next;
    });
  }

  protected pickModel(model: string): void {
    this.model.set(model);
  }

  protected async chooseFolder(): Promise<void> {
    const cwd = await this.bridge.chooseFolder().catch(() => null);
    if (cwd) this.cwd.set(cwd);
  }

  protected async save(): Promise<void> {
    if (!this.complete() || this.saving()) return;
    const cwd = this.cwd() ?? this.chats.folders().home;
    const model = this.model();
    const effort = this.effort();
    const draft: ScheduleDraft = {
      ...(this.schedule() ? { id: this.schedule()!.id } : {}),
      name: this.name(),
      agent: this.agent(),
      settings: { ...(cwd ? { cwd } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) },
      prompt: this.prompt(),
      days: [...this.days()],
      time: this.time(),
      enabled: this.schedule()?.enabled ?? true,
    };
    this.saving.set(true);
    try {
      if (await this.scheduled.save(draft)) this.done.emit();
    } finally {
      this.saving.set(false);
    }
  }
}
