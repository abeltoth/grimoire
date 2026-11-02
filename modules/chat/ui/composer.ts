import {
  Component,
  DestroyRef,
  ElementRef,
  PendingTasks,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  AgentCommand,
  AgentId,
  ContextUsage,
  Enclosure,
  QueuedEntry,
} from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { AgentCommands } from '@ui/app/shell/agent-commands';
import { Enclosures } from './enclosures';
import { readPicture } from './pictures';

/**
 * The next page, tucked under the transcript: where you write the next
 * entry. Enter sends it; Shift+Enter starts a new line. What you send
 * while a turn runs waits above it until the turn ends. A "/" at the start
 * turns the facing page to the agent's commands, which the entry's keys
 * move through and use. Files and pictures come in through Attach, or by
 * dropping or pasting them, and go with the entry.
 */
@Component({
  selector: 'gr-composer',
  imports: [Enclosures, Icon],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
  host: { role: 'region', 'aria-label': 'Next page' },
})
export class Composer {
  protected readonly chats = inject(Chats);
  private readonly commands = inject(AgentCommands);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);

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
  /** The pictures and files to send with it. */
  protected readonly enclosures = linkedSignal<string, readonly Enclosure[]>({
    source: this.chapterId,
    computation: () => [],
  });

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
    const enclosures = this.enclosures();
    if (!text && !enclosures.length) return;
    // Cleared on the element too: Enter can come before the last keystroke is rendered.
    entry.value = '';
    this.draft.set('');
    this.enclosures.set([]);
    void this.chats.send(this.chapterId(), text, enclosures);
  }

  /** Asks for files with the system's picker. */
  protected async attach(): Promise<void> {
    const paths = await this.bridge.chooseFiles().catch(() => []);
    this.enclose(paths.map((path): Enclosure => ({ kind: 'file', path })));
  }

  /** A pasted picture comes in as a plate; anything else pastes as usual. */
  protected paste(event: ClipboardEvent): void {
    const pictures = [...(event.clipboardData?.files ?? [])].filter((file) =>
      file.type.startsWith('image/'),
    );
    if (!pictures.length) return;
    event.preventDefault();
    for (const picture of pictures) this.addPicture(picture, `Screenshot, pasted at ${now()}`);
  }

  /** Files dropped on the page come in as references; pictures from elsewhere, as plates. */
  drop(event: DragEvent): void {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    for (const file of files) {
      const path = this.bridge.pathOf(file);
      if (path) this.enclose([{ kind: 'file', path }]);
      else if (file.type.startsWith('image/')) this.addPicture(file, `Picture, dropped at ${now()}`);
    }
  }

  protected unenclose(enclosure: Enclosure): void {
    this.enclosures.update((all) => all.filter((kept) => kept !== enclosure));
    this.entry().nativeElement.focus();
  }

  private addPicture(file: Blob, caption: string): void {
    this.pending.run(async () => {
      const picture = await readPicture(file);
      this.enclose([{ kind: 'picture', ...picture, caption }]);
    });
  }

  /** Adds to what goes with the entry; a file already there isn't added twice. */
  private enclose(added: readonly Enclosure[]): void {
    this.enclosures.update((all) => [
      ...all,
      ...added.filter(
        (enclosure) =>
          enclosure.kind !== 'file' ||
          !all.some((kept) => kept.kind === 'file' && kept.path === enclosure.path),
      ),
    ]);
  }

  /** Puts messages back on the page, after what you're writing, to edit or send again. */
  takeBack(entries: readonly QueuedEntry[]): void {
    if (!entries.length) return;
    this.draft.update((draft) =>
      [draft.trim(), ...entries.map((queued) => queued.text)].filter(Boolean).join('\n\n'),
    );
    this.enclose(entries.flatMap((queued) => queued.enclosures ?? []));
    const entry = this.entry().nativeElement;
    entry.value = this.draft();
    entry.focus();
    entry.setSelectionRange(entry.value.length, entry.value.length);
  }

  protected async edit(queued: QueuedEntry): Promise<void> {
    if (await this.chats.unqueue(this.chapterId(), queued.id)) this.takeBack([queued]);
  }

  protected remove(queued: QueuedEntry): void {
    void this.chats.unqueue(this.chapterId(), queued.id);
  }
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
