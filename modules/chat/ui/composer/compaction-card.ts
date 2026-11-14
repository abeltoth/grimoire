import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  AgentId,
  CompactionChange,
  CompactionSettings,
  ContextUsage,
} from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatActions } from '@ui/app/core/chat-actions';
import { modelLabel, tokenCount } from '@ui/app/core/tokens';
import { Icon } from '@ui/design-system/icon';
import { Wording } from '@ui/app/core/wording';
import { STEP, along, snap, stops } from './compaction-scale';

/**
 * The window the agent compacts this chat's model in, opened from its
 * context meter: Auto, or set on a slider that snaps to round sizes. A
 * size is saved in your agent's settings as you let go; every open chat on
 * the model takes it once its turn ends. "Compact now" compacts this chat.
 * Esc or a click elsewhere closes it.
 */
@Component({
  selector: 'gr-compaction-card',
  imports: [Icon],
  templateUrl: './compaction-card.html',
  styleUrl: './compaction-card.css',
  host: {
    role: 'dialog',
    'aria-labelledby': 'gr-compaction-heading',
    '(document:pointerdown)': 'pointerDown($event)',
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class CompactionCard {
  readonly chatId = input.required<string>();
  readonly agent = input.required<AgentId>();
  readonly context = input.required<ContextUsage>();
  /** The meter it opened from: a click on it isn't a click elsewhere. */
  readonly anchor = input<HTMLElement>();
  readonly closed = output<void>();

  protected readonly wording = inject(Wording);
  private readonly catalog = inject(AgentCatalog);
  private readonly actions = inject(ChatActions);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly tokenCount = tokenCount;
  protected readonly step = STEP;

  /** What the agent says; undefined while it's asked, null when it can't say. */
  protected readonly settings = signal<CompactionSettings | null | undefined>(undefined);
  protected readonly failed = signal('');
  /** The size being dragged to, until it's let go. */
  protected readonly draft = signal<number | undefined>(undefined);
  protected readonly saving = signal(false);
  /** Whether the size shown was saved. */
  protected readonly saved = signal(false);

  protected readonly agentName = computed(() => this.catalog.agentName(this.agent()));
  /** The measured model as you'd say it, such as "Opus 5.5". */
  protected readonly modelName = computed(() => {
    const model = this.context().model;
    return model ? modelLabel(model) : this.catalog.modelName(this.agent(), undefined);
  });

  /** The size the slider shows: the one dragged to, else the one set, else the one measured. */
  protected readonly size = computed(() => {
    const window = this.settings()?.window;
    return this.draft() ?? (typeof window === 'number' ? window : this.context().limit);
  });
  protected readonly auto = computed(
    () => this.draft() === undefined && this.settings()?.window === 'auto',
  );
  protected readonly stops = computed(() => {
    const s = this.settings();
    return s ? stops(s.min, s.max) : [];
  });

  /** The size and where the chat compacts in it, as they'd read. */
  protected readonly reading = computed(() => {
    const s = this.settings();
    if (!s) return '';
    const size = tokenCount(this.size());
    const at = tokenCount(this.size() - s.reserve);
    return this.auto()
      ? `Auto, ${this.agentName()}’s own · ${size}, compacts at ${at}`
      : `${size} · compacts at ${at}`;
  });

  /** Whether the size shown is too small for what the chat holds already. */
  protected readonly compactsNext = computed(() => {
    const s = this.settings();
    return !!s && this.size() - s.reserve <= this.context().used;
  });

  constructor() {
    effect(() => void this.load(this.chatId()));
  }

  protected along(size: number): number {
    const s = this.settings();
    return s ? along(size, s.min, s.max) : 0;
  }

  protected drag(field: HTMLInputElement): void {
    const s = this.settings();
    if (!s) return;
    const size = snap(Number(field.value), s.min, s.max);
    field.value = String(size);
    this.draft.set(size);
    this.saved.set(false);
  }

  protected release(): void {
    const size = this.draft();
    if (size !== undefined) void this.save({ window: size });
  }

  protected async save(change: CompactionChange): Promise<void> {
    const s = this.settings();
    if (!s) return;
    this.saving.set(true);
    this.saved.set(false);
    this.failed.set('');
    try {
      await this.bridge.invoke('agents.setCompaction', { chatId: this.chatId(), change });
      this.settings.set({ ...s, ...change });
      this.saved.set(true);
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.draft.set(undefined);
      this.saving.set(false);
    }
  }

  protected compactNow(): void {
    void this.actions.send(this.chatId(), '/compact');
    this.closed.emit();
  }

  protected pointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target || this.host.contains(target) || this.anchor()?.contains(target)) return;
    this.closed.emit();
  }

  private async load(chatId: string): Promise<void> {
    this.settings.set(undefined);
    try {
      this.settings.set(await this.bridge.invoke('agents.compaction', { chatId }));
    } catch (error) {
      this.settings.set(null);
      this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }
}
