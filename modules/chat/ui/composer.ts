import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  untracked,
  viewChild,
} from '@angular/core';
import type { AgentCommand, AgentId, ContextUsage, QueuedEntry } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';
import { AgentCommands } from '@ui/app/shell/agent-commands';

/**
 * The next page, tucked under the transcript: where you write the next
 * entry. Enter sends it; Shift+Enter starts a new line. What you send
 * while a turn runs waits above it until the turn ends. A "/" at the start
 * turns the facing page to the agent's commands, which the entry's keys
 * move through and use.
 */
@Component({
  selector: 'gr-composer',
  imports: [Icon],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  host: { role: 'region', 'aria-label': 'Next page' },
})
export class Composer {
  protected readonly chats = inject(Chats);
  private readonly commands = inject(AgentCommands);

  readonly chapterId = input.required<string>();
  readonly agent = input.required<AgentId>();
  /** The chapter's folder, where the agent's commands are looked up. */
  readonly cwd = input<string>();
  /** A blank chapter's composer: it takes the first entry. */
  readonly first = input(false);
  readonly queued = input<readonly QueuedEntry[]>([]);
  /** How full the context window is: the chapter's page allowance. */
  readonly context = input<ContextUsage>();

  /** The share of the allowance used, in percent; missing until the agent reports it. */
  protected readonly used = computed(() => {
    const context = this.context();
    return context?.limit ? Math.round((context.used / context.limit) * 100) : undefined;
  });

  private readonly entry = viewChild.required<ElementRef<HTMLTextAreaElement>>('entry');

  /** What you're writing; a fresh page for each chapter. */
  protected readonly draft = linkedSignal({ source: this.chapterId, computation: () => '' });

  /** Whether the facing page lists the agent's commands for this entry. */
  protected readonly lookingUp = computed(
    () => this.commands.lookUp()?.chapterId === this.chapterId(),
  );
  /** The command the facing page points at, while it lists them. */
  protected readonly chosen = computed(() =>
    this.lookingUp() ? this.commands.chosen() : undefined,
  );

  constructor() {
    // A fresh page for another chapter; the commands were looked up for the last one.
    effect(() => {
      const chapterId = this.chapterId();
      untracked(() => {
        const lookUp = this.commands.lookUp();
        if (lookUp && lookUp.chapterId !== chapterId) this.commands.close();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.lookingUp()) this.commands.close();
    });
  }

  /** Keeps what you write, and looks up the agent's commands while it's a "/" and a name. */
  protected write(text: string): void {
    this.draft.set(text);
    const slash = /^\/(\S*)$/.exec(text);
    if (slash) {
      const cwd = this.cwd();
      this.commands.open({
        chapterId: this.chapterId(),
        agent: this.agent(),
        ...(cwd ? { cwd } : {}),
        query: slash[1]!,
        use: (command) => this.use(command),
      });
    } else if (this.lookingUp()) this.commands.close();
  }

  protected key(event: KeyboardEvent, entry: HTMLTextAreaElement): void {
    if (event.isComposing) return;
    const chosen = this.chosen();
    if (this.lookingUp() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      this.commands.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (chosen && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.complete(chosen, entry);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (chosen) this.use(chosen);
      else this.send(entry);
    }
  }

  /** Writes the command's name in full, ready for what it takes. */
  private complete(command: AgentCommand, entry: HTMLTextAreaElement): void {
    const text = `/${command.name} `;
    entry.value = text;
    this.draft.set(text);
    this.commands.close();
    entry.setSelectionRange(text.length, text.length);
  }

  private use(command: AgentCommand): void {
    const entry = this.entry().nativeElement;
    entry.value = `/${command.name}`;
    this.send(entry);
    entry.focus();
  }

  protected send(entry: HTMLTextAreaElement): void {
    if (this.lookingUp()) this.commands.close();
    const text = entry.value.trim();
    if (!text) return;
    // Cleared on the element too: Enter can come before the last keystroke is rendered.
    entry.value = '';
    this.draft.set('');
    void this.chats.send(this.chapterId(), text);
  }

  /** Puts messages back on the page, after what you're writing, to edit or send again. */
  takeBack(texts: readonly string[]): void {
    if (!texts.length) return;
    this.draft.update((draft) => [draft.trim(), ...texts].filter(Boolean).join('\n\n'));
    const entry = this.entry().nativeElement;
    entry.value = this.draft();
    entry.focus();
    entry.setSelectionRange(entry.value.length, entry.value.length);
  }

  protected async edit(queued: QueuedEntry): Promise<void> {
    if (await this.chats.unqueue(this.chapterId(), queued.id)) this.takeBack([queued.text]);
  }

  protected remove(queued: QueuedEntry): void {
    void this.chats.unqueue(this.chapterId(), queued.id);
  }
}
