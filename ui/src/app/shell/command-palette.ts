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
import { RightPageState } from './right-page-state';
import { Focus } from './focus';
import { PageFooter } from './page-footer';
import { PageHeader } from './page-header';
import { ShellRegistry } from './shell-registry';
import { type Shortcut, formatShortcut } from './shortcut';

/** One line of the command palette: something you can do or open. */
interface CommandPaletteEntry {
  id: string;
  label: string;
  /** A gloss after the label, such as "with your last settings". */
  hint?: string;
  /** A folder after the gloss, in type. */
  folder?: string;
  shortcut?: Shortcut;
  /** Where it lives, when that's another page: "in History". */
  where?: string;
  /** It turns the command palette to a list of its own instead of closing it. */
  opensList?: true;
  run: () => void;
}

/** An entry as listed: its label split around the part you searched for. */
interface Listed extends CommandPaletteEntry {
  parts: [before: string, match: string, after: string];
}

interface Section {
  title: string;
  entries: Listed[];
}

/** Chats past this many are left for the History. */
const MAX_CHATS = 8;

/**
 * The command palette, on the right page: every action
 * with its shortcut, and the chats you've had, searched as you type. ↑ and ↓
 * move, Enter opens, and Esc turns back. "New chat from preset" lists the
 * presets instead, until Esc.
 */
@Component({
  selector: 'gr-command-palette',
  imports: [Icon, PageFooter, PageHeader],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
  host: { '(document:keydown.escape)': 'back($event)' },
})
export class CommandPalette {
  /** The label of the page it turns back to. */
  readonly backTo = input.required<string>();

  protected readonly rightPage = inject(RightPageState);
  private readonly registry = inject(ShellRegistry);
  private readonly chats = inject(Chats);
  private readonly presets = inject(Presets);
  protected readonly wording = inject(Wording);
  protected readonly focus = inject(Focus);
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly query = linkedSignal(() => this.rightPage.commandPalette() ?? '');
  private readonly pastChats = signal<readonly ChatSummary[]>([]);
  /** Whether the command palette lists the presets, to begin a chat with one. */
  protected readonly listingPresets = signal(false);

  protected readonly sections = computed<Section[]>(() => {
    const query = this.query().trim();
    if (this.listingPresets()) {
      const presets = this.presets.all().map(
        (preset): CommandPaletteEntry => ({
          id: `preset-${preset.name}`,
          label: preset.name,
          hint: `${this.presets.describe(preset)} ·`,
          folder: this.chats.folderName(preset.settings.cwd),
          where: this.wording.say('new chapter', 'new chat'),
          run: () => this.chats.newChat(preset),
        }),
      );
      return [{ title: 'Presets', entries: matching(presets, query) }].filter((s) => s.entries.length);
    }
    const commands = this.registry.commands
      .all()
      .filter((command) => command.run && command.id !== 'shell.commandPalette')
      .map(
        (command): CommandPaletteEntry => ({
          id: `action-${command.id}`,
          label: this.wording.label(command),
          ...(command.hint
            ? { hint: typeof command.hint === 'string' ? command.hint : command.hint() }
            : {}),
          ...(command.shortcut ? { shortcut: command.shortcut } : {}),
          run: command.run!,
        }),
      );
    const fromPreset: CommandPaletteEntry = {
      id: 'action-from-preset',
      label: this.wording.say('New chapter from preset', 'New chat from preset'),
      hint: 'pick a preset first',
      where: 'opens a list ›',
      opensList: true,
      run: () => {
        this.listingPresets.set(true);
        this.query.set('');
      },
    };
    const after = commands.findIndex((entry) => entry.id === 'action-chats.new') + 1;
    const actions = [...commands.slice(0, after), fromPreset, ...commands.slice(after)];
    // Chats come newest first, so a stable sort keeps that order within each rank.
    const rank = this.registry.rankChat() ?? (() => 0);
    const chats = [...this.pastChats()].sort((a, b) => rank(b) - rank(a)).map(
      (chat): CommandPaletteEntry => ({
        id: `chat-${chat.id}`,
        label: chat.title || this.wording.untitled(),
        hint: `${this.chats.agentName(chat.agent)} ·`,
        folder: this.chats.folderName(chat.cwd),
        where: this.wording.say('in Table of contents', 'in History'),
        run: () => void this.chats.openChat(chat),
      }),
    );
    const sections: Section[] = [
      { title: 'Actions', entries: matching(actions, query) },
      {
        title: this.wording.say('Chapters', 'Chats'),
        entries: matching(chats, query).slice(0, MAX_CHATS),
      },
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
    const [one, many] = this.wording.plain() ? ['result', 'results'] : ['entry', 'entries'];
    return `${count} ${count === 1 ? one : many}`;
  });

  protected readonly entriesLabel = computed(() => {
    const entries = this.wording.say('Index entries', 'Commands and chats');
    return this.query() ? `${entries} for ${this.query()}` : entries;
  });

  /** Why nothing is listed. */
  protected readonly empty = computed(() =>
    this.listingPresets() && !this.presets.all().length
      ? this.wording.say(
          'No saved presets yet. Save one on a chapter’s settings card.',
          'No saved presets yet. Save one in a chat’s settings.',
        )
      : this.wording.say(
          `Nothing in the index matches “${this.query()}”.`,
          `Nothing matches “${this.query()}”.`,
        ),
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

  protected readonly commandPaletteCaps = computed(() => {
    const shortcut = this.registry.commands.get('shell.commandPalette')?.shortcut;
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

  protected open(entry: CommandPaletteEntry): void {
    if (!entry.opensList) this.rightPage.closeCommandPalette();
    entry.run();
    if (entry.opensList) this.field().nativeElement.focus();
  }

  /** Esc turns back from the presets to the whole command palette, and from there to the right page. */
  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (this.listingPresets()) {
      this.listingPresets.set(false);
      this.query.set('');
    } else this.rightPage.closeCommandPalette();
  }

  private move(step: number): void {
    const listed = this.listed();
    const at = listed.findIndex((entry) => entry.id === this.selected());
    const next = listed[Math.min(Math.max(at + step, 0), listed.length - 1)];
    if (next) this.selected.set(next.id);
  }
}

/** The entries whose label holds what you searched for, split around it. */
function matching(entries: CommandPaletteEntry[], query: string): Listed[] {
  const needle = query.toLowerCase();
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
