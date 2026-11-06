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
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  AgentCommand,
  AgentId,
  ContextUsage,
  Enclosure,
  PromptCache,
  QueuedEntry,
} from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { LEAF } from '@ui/app/core/leaf';
import { Wording } from '@ui/app/core/wording';
import { AgentCommands } from '@ui/app/shell/agent-commands';
import { Focus } from '@ui/app/shell/focus';
import { Drafts } from './drafts';
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
  host: { role: 'region', '[attr.aria-label]': "wording.say('Next page', 'Message')" },
})
export class Composer {
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  private readonly commands = inject(AgentCommands);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly drafts = inject(Drafts);
  private readonly focus = inject(Focus);
  /** In a loose leaf's window: no facing page, so its commands are listed above it. */
  protected readonly leaf = !!inject(LEAF);

  readonly chapterId = input.required<string>();
  readonly agent = input.required<AgentId>();
  /** The chapter's folder, where the agent's commands are looked up. */
  readonly cwd = input<string>();
  /** A blank chapter's composer: it takes the first entry. */
  readonly first = input(false);
  /** The first entry the chapter's preset has written in, until you change it. */
  readonly prompt = input('');
  readonly queued = input<readonly QueuedEntry[]>([]);
  /** How full the context window is: the chapter's page allowance. */
  readonly context = input<ContextUsage>();
  /** What the last reply left in the prompt cache, while no turn runs. */
  readonly cache = input<PromptCache>();
  /** What you wrote in this chapter, oldest first, for Up to bring back. */
  readonly sent = input<readonly string[]>([]);
  /** The entry field's ID, one for each page's entry. */
  readonly entryId = input('gr-next-entry');
  /** On the facing page, so its commands are looked up on the left page. */
  readonly beside = input(false);

  /** The model the entry goes to as well, in parallel; none until Parallel is pressed. */
  protected readonly parallel = linkedSignal<string, string | null>({
    source: this.chapterId,
    computation: () => null,
  });
  /** The agent's other models, which a parallel text could be on. */
  protected readonly otherModels = computed(() => {
    const listed = this.chats.models()[this.agent()];
    const chapter = this.chats.all().find((c) => c.id === this.chapterId());
    const own = chapter?.settings.model ?? listed?.default;
    return (listed?.models ?? []).filter((model) => model.id !== own);
  });
  /**
   * Whether the entry can go to two models, the second on the facing page:
   * not from the facing page or a loose leaf, and from a chapter that has
   * begun only when the agent can copy it.
   */
  protected readonly canParallel = computed(() => {
    const chapter = this.chats.all().find((c) => c.id === this.chapterId());
    if (!chapter || this.beside() || this.leaf || !this.otherModels().length) return false;
    return chapter.status === 'blank' || this.chats.can(this.agent(), 'fork');
  });
  /** Whether it can go now: a chapter that has begun is copied between turns. */
  protected readonly parallelNow = computed(() => {
    const status = this.chats.all().find((c) => c.id === this.chapterId())?.status;
    return status === 'blank' || status === 'idle';
  });
  /** The second model, while Parallel is on and the entry can go to it. */
  protected readonly second = computed(() => {
    const picked = this.parallel();
    if (picked === null || !this.canParallel() || !this.parallelNow()) return undefined;
    const others = this.otherModels();
    return others.find((model) => model.id === picked) ?? others[0];
  });

  /** The time, kept to the minute, for when the cache runs out. */
  private readonly now = signal(Date.now());
  /** Once the cache has run out: when, and the tokens the next entry re-reads. */
  protected readonly cold = computed(() => {
    const cache = this.cache();
    const now = this.now();
    if (!cache || cache.until > now) return undefined;
    return { ago: ago(now - cache.until), tokens: tokens(cache.tokens) };
  });

  /** Which of your entries Up brought back, counted back from the last, and its text. */
  private recalled: { back: number; text: string } | null = null;

  /** The share of the allowance used, in percent; missing until the agent reports it. */
  protected readonly used = computed(() => {
    const context = this.context();
    return context?.limit ? Math.round((context.used / context.limit) * 100) : undefined;
  });

  private readonly entry = viewChild.required<ElementRef<HTMLTextAreaElement>>('entry');

  /**
   * What you're writing; each chapter keeps its own until it's sent. A
   * preset's first entry is written in while there's nothing else, and
   * another preset's takes its place until you change it.
   */
  protected readonly draft = linkedSignal<{ id: string; prompt: string }, string>({
    source: () => ({ id: this.chapterId(), prompt: this.prompt() }),
    computation: ({ id, prompt }, previous) => {
      const kept = this.drafts.of(id).text;
      const untouched = !kept || (previous?.source.id === id && kept === previous.source.prompt);
      return untouched ? prompt : kept;
    },
  });
  /** The pictures and files to send with it. */
  protected readonly enclosures = linkedSignal<string, readonly Enclosure[]>({
    source: this.chapterId,
    computation: (id) => this.drafts.of(id).enclosures,
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
    // What you write stays with its chapter while you turn to another.
    effect(() =>
      this.drafts.keep(this.chapterId(), { text: this.draft(), enclosures: this.enclosures() }),
    );
    // A fresh page for another chapter; the commands were looked up for the last one.
    effect(() => {
      const chapterId = this.chapterId();
      untracked(() => {
        const lookUp = this.commands.lookUp();
        if (lookUp && lookUp.chapterId !== chapterId) this.commands.close();
      });
    });
    // Another chapter's entries to bring back.
    effect(() => {
      this.chapterId();
      this.recalled = null;
    });
    const minute = setInterval(() => this.now.set(Date.now()), 60_000);
    // Read again the moment the cache runs out, not up to a minute later.
    effect((onCleanup) => {
      const until = this.cache()?.until;
      untracked(() => this.now.set(Date.now()));
      const wait = until === undefined ? -1 : until - Date.now();
      if (wait <= 0 || wait > 2 ** 31 - 1) return;
      const timer = setTimeout(() => this.now.set(Date.now()), wait + 50);
      onCleanup(() => clearTimeout(timer));
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(minute);
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
    } else if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      this.recall(event.key === 'ArrowUp' ? 1 : -1, entry)
    ) {
      event.preventDefault();
    } else if (chosen && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.complete(chosen, entry);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (chosen) this.use(chosen);
      else this.send(entry);
    }
  }

  /**
   * Up in an empty entry brings back your last one, and again the one
   * before; Down goes the other way, back to an empty entry. Once you change
   * what came back, the keys move the caret again. Whether it took the key.
   */
  private recall(step: 1 | -1, entry: HTMLTextAreaElement): boolean {
    const sent = this.sent();
    const value = entry.value;
    const recalled = value !== '' && value === this.recalled?.text ? this.recalled : null;
    if (value !== '' && !recalled) return false;
    // In an entry of several lines, only from its first line up or its last line down.
    const caret = entry.selectionStart ?? 0;
    if (recalled && step === 1 && value.lastIndexOf('\n', caret - 1) !== -1) return false;
    if (recalled && step === -1 && value.indexOf('\n', caret) !== -1) return false;
    const back = (recalled?.back ?? 0) + step;
    if (back < 1) {
      if (!recalled) return false;
      this.recalled = null;
      this.fill(entry, '');
      return true;
    }
    const text = sent[sent.length - back];
    // Already at your first entry: Up stays on it.
    if (text === undefined) return !!recalled;
    this.recalled = { back, text };
    this.fill(entry, text);
    return true;
  }

  private fill(entry: HTMLTextAreaElement, text: string): void {
    entry.value = text;
    this.draft.set(text);
    entry.setSelectionRange(text.length, text.length);
  }

  /** Has the agent sum the chapter up before your next entry. */
  protected compact(): void {
    void this.chats.send(this.chapterId(), '/compact');
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
    const second = this.second();
    if (!second) {
      void this.chats.send(this.chapterId(), text, enclosures);
      return;
    }
    this.parallel.set(null);
    // The second chapter goes on the facing page, so both pages show.
    this.focus.leave();
    void this.chats.sendParallel(this.chapterId(), second.id, text, enclosures);
  }

  /** Turns Parallel on, on the first of the other models, or off. */
  protected toggleParallel(): void {
    if (!this.parallelNow()) return;
    this.parallel.set(this.second() ? null : (this.otherModels()[0]?.id ?? null));
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

/** How long ago, in words: "20 minutes ago", "3 hours ago", "2 days ago". */
function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes === 1 ? 'A minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'An hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'A day ago' : `${days} days ago`;
}

/** A count of tokens, rounded: "850", "283k", "1.2M". */
function tokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
