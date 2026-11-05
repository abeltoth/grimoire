import {
  Component,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import type { ChatSummary } from '@grimoire/contract';
import { Icon } from '../../design-system/icon';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import { Chats } from '../core/chats';
import { Presets } from '../core/presets';
import { Wording } from '../core/wording';
import { Facing } from './facing';
import { RunningFoot } from './running-foot';
import { RunningHead } from './running-head';
import { ShellRegistry } from './shell-registry';
import { type Shortcut, formatShortcut } from './shortcut';

/** One line of the Index: something you can do or open. */
interface IndexEntry {
  id: string;
  label: string;
  /** A gloss after the label, such as "with your last settings". */
  hint?: string;
  /** A folder after the gloss, in type. */
  folder?: string;
  shortcut?: Shortcut;
  /** Where it lives, when that's another page: "in Table of contents". */
  where?: string;
  /** It turns the Index to a list of its own instead of closing it. */
  opensList?: true;
  run: () => void;
}

/** An entry as listed: its label split around the part you looked up. */
interface Listed extends IndexEntry {
  parts: [before: string, match: string, after: string];
}

interface Section {
  title: string;
  entries: Listed[];
}

/** Chapters past this many are left for the Table of contents. */
const MAX_CHAPTERS = 8;

/**
 * The Index, the book's command palette, on the facing page: every action
 * with its shortcut, and the chats you've had, looked up as you type. ↑ and ↓
 * move, Enter opens, and Esc turns back. "New chapter from preset" lists the
 * presets instead, until Esc.
 */
@Component({
  selector: 'gr-index-page',
  imports: [Icon, RunningFoot, RunningHead],
  templateUrl: './index-page.html',
  styleUrl: './index-page.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class IndexPage {
  /** The label of the page it turns back to. */
  readonly backTo = input('facing page');

  protected readonly facing = inject(Facing);
  private readonly registry = inject(ShellRegistry);
  private readonly chats = inject(Chats);
  private readonly presets = inject(Presets);
  private readonly wording = inject(Wording);
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly lookUp = linkedSignal(() => this.facing.index() ?? '');
  private readonly pastChats = signal<readonly ChatSummary[]>([]);
  /** Whether the Index lists the presets, to begin a chapter with one. */
  protected readonly listingPresets = signal(false);

  protected readonly sections = computed<Section[]>(() => {
    const lookUp = this.lookUp().trim();
    if (this.listingPresets()) {
      const presets = this.presets.all().map(
        (preset): IndexEntry => ({
          id: `preset-${preset.name}`,
          label: preset.name,
          hint: `${this.presets.describe(preset)} ·`,
          folder: this.chats.folderName(preset.settings.cwd),
          where: 'new chapter',
          run: () => this.chats.newChapter(preset),
        }),
      );
      return [{ title: 'Presets', entries: matching(presets, lookUp) }].filter((s) => s.entries.length);
    }
    const commands = this.registry.commands
      .all()
      .filter((command) => command.run && command.id !== 'shell.index')
      .map(
        (command): IndexEntry => ({
          id: `action-${command.id}`,
          label: this.wording.label(command),
          ...(command.hint
            ? { hint: typeof command.hint === 'string' ? command.hint : command.hint() }
            : {}),
          ...(command.shortcut ? { shortcut: command.shortcut } : {}),
          run: command.run!,
        }),
      );
    const fromPreset: IndexEntry = {
      id: 'action-from-preset',
      label: 'New chapter from preset',
      hint: 'pick a preset first',
      where: 'opens a list ›',
      opensList: true,
      run: () => {
        this.listingPresets.set(true);
        this.lookUp.set('');
      },
    };
    const after = commands.findIndex((entry) => entry.id === 'action-chapters.new') + 1;
    const actions = [...commands.slice(0, after), fromPreset, ...commands.slice(after)];
    // Pinned chapters stay at the top; the rest are newest first.
    const pinned = (chat: ChatSummary) => Number(chat.dogEars.includes('pin'));
    const chapters = [...this.pastChats()].sort((a, b) => pinned(b) - pinned(a)).map(
      (chat): IndexEntry => ({
        id: `chapter-${chat.id}`,
        label: chat.title || 'Untitled chapter',
        hint: `${this.chats.agentName(chat.agent)} ·`,
        folder: this.chats.folderName(chat.cwd),
        where: 'in Table of contents',
        run: () => void this.chats.openChat(chat),
      }),
    );
    const sections: Section[] = [
      { title: 'Actions', entries: matching(actions, lookUp) },
      { title: 'Chapters', entries: matching(chapters, lookUp).slice(0, MAX_CHAPTERS) },
    ];
    return sections.filter((section) => section.entries.length);
  });
  private readonly listed = computed(() => this.sections().flatMap((section) => section.entries));
  protected readonly selected = linkedSignal({
    source: this.listed,
    computation: (listed: Listed[]) => listed[0]?.id,
  });
  protected readonly count = computed(() => {
    const count = this.listed().length;
    return `${count} ${count === 1 ? 'entry' : 'entries'}`;
  });

  /** Why nothing is listed. */
  protected readonly empty = computed(() =>
    this.listingPresets() && !this.presets.all().length
      ? 'No saved presets yet. Save one on a chapter’s settings card.'
      : `Nothing in the index matches “${this.lookUp()}”.`,
  );

  constructor() {
    void this.chats.pastChats().then((chats) => this.pastChats.set(chats));
    void this.presets.load();
    afterNextRender(() => this.field().nativeElement.focus());
    afterRenderEffect(() => {
      this.selected();
      this.host.querySelector('.entry[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** A shortcut as key caps: "Ctrl", "N". */
  protected caps(shortcut: Shortcut): string[] {
    const keys = formatShortcut(shortcut, this.platform, 'keys');
    return this.platform === 'mac' ? [...keys] : keys.split(' ');
  }

  protected readonly indexCaps = computed(() => {
    const shortcut = this.registry.commands.get('shell.index')?.shortcut;
    return shortcut ? this.caps(shortcut) : [];
  });

  protected key(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.listed().find((listed) => listed.id === this.selected());
      if (entry) this.open(entry);
    }
  }

  protected open(entry: IndexEntry): void {
    if (!entry.opensList) this.facing.closeIndex();
    entry.run();
    if (entry.opensList) this.field().nativeElement.focus();
  }

  /** Esc turns back from the presets to the whole Index, and from there to the facing page. */
  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (this.listingPresets()) {
      this.listingPresets.set(false);
      this.lookUp.set('');
    } else this.facing.closeIndex();
  }

  private move(step: number): void {
    const listed = this.listed();
    const at = listed.findIndex((entry) => entry.id === this.selected());
    const next = listed[Math.min(Math.max(at + step, 0), listed.length - 1)];
    if (next) this.selected.set(next.id);
  }
}

/** The entries whose label holds what you looked up, split around it. */
function matching(entries: IndexEntry[], lookUp: string): Listed[] {
  const needle = lookUp.toLowerCase();
  return entries.flatMap((entry) => {
    const at = entry.label.toLowerCase().indexOf(needle);
    if (at === -1) return [];
    const end = at + needle.length;
    const parts: Listed['parts'] = [
      entry.label.slice(0, at),
      entry.label.slice(at, end),
      entry.label.slice(end),
    ];
    return [{ ...entry, parts }];
  });
}
