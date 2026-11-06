import {
  type EnvironmentProviders,
  Injectable,
  type Type,
  computed,
  effect,
  inject,
  provideAppInitializer,
  signal,
  untracked,
} from '@angular/core';
import type { IconName } from '../../design-system/icon';
import { Chats } from '../core/chats';
import { Wording } from '../core/wording';
import { Facing } from './facing';
import { Focus } from './focus';
import { noteWaitingChapters } from './focus-notes';
import type { Shortcut } from './shortcut';

interface Entry {
  id: string;
  /** Lower comes first; entries without one keep the order they were added in. */
  order?: number;
}

/** A label, with what it says in plain names when the book's names are turned off. */
interface Labelled {
  label: string;
  /** The label in plain names, such as "History" for "Table of contents"; without it the label stays. */
  plainLabel?: string;
}

/** A tab on the fore-edge that turns the facing page to one of the book's pages. */
export interface ThumbTab extends Entry, Labelled {
  /** What the page shows; without it the page is blank, its feature not written yet. */
  component?: Type<unknown>;
}

/** Something the facing page can show, picked from the tabs in its running head. */
export interface FacingPageEntry extends Entry, Labelled {
  /** Without it the tab shows but can't be picked yet. */
  component?: Type<unknown>;
  /** A line for the running foot while it shows, such as "3 of 5 done". */
  foot?: () => string;
  /** What its tab says for now, such as the title of the chapter it shows; its label when none. */
  heading?: () => string | undefined;
  /** It draws the whole page itself, its running head with the tabs and its foot. */
  whole?: boolean;
}

/** A status in the chapter's running foot, such as the git branch. */
export interface Indicator extends Entry {
  label: string;
  icon?: IconName;
  /** An alert shows in rubric. */
  tone?: 'alert';
  /** More about it, shown on hover. */
  detail?: string;
  /** Without it the indicator shows but does nothing yet. */
  open?: () => void;
}

/** A stamp in the chapter's running head, such as its pull request's review. */
export interface Stamp extends Entry {
  label: string;
  /** An alert is stamped in rubric, a quiet one in plain ink. */
  tone?: 'alert' | 'quiet';
  /** More about it, shown on hover. */
  detail?: string;
  open?: () => void;
}

/** Something you can do from the Index or with a shortcut. */
export interface Command extends Entry, Labelled {
  /** A gloss the Index shows after the label, such as "with your last settings". */
  hint?: string | (() => string);
  shortcut?: Shortcut;
  run?: () => void;
}

/** A list in the shell that modules add entries to. */
export class Slot<T extends Entry> {
  private readonly entries = signal<readonly T[]>([]);

  readonly all = computed(() =>
    [...this.entries()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );

  /** Adds an entry and returns a function that removes it again. Safe to call from an effect. */
  add(entry: T): () => void {
    if (untracked(this.entries).some((existing) => existing.id === entry.id)) {
      throw new Error(`"${entry.id}" is already registered`);
    }
    this.entries.update((entries) => [...entries, entry]);
    return () => this.entries.update((entries) => entries.filter((existing) => existing !== entry));
  }

  get(id: string): T | undefined {
    return this.entries().find((entry) => entry.id === id);
  }
}

/**
 * The places in the shell that features fill (ADR-008): thumb tabs, facing
 * pages, running-foot indicators, running-head stamps and commands. The shell draws whatever is
 * registered here and knows nothing about the features themselves.
 */
@Injectable({ providedIn: 'root' })
export class ShellRegistry {
  readonly thumbs = new Slot<ThumbTab>();
  readonly facingPages = new Slot<FacingPageEntry>();
  readonly indicators = new Slot<Indicator>();
  readonly stamps = new Slot<Stamp>();
  readonly commands = new Slot<Command>();
  /** What the left page shows for the open chapter: the chat module's page. */
  readonly chapterPage = signal<Type<unknown> | undefined>(undefined);
  /**
   * What the facing page shows when it's turned to the slips awaiting your
   * seal: the chat module's page. It takes a `backTo` input, the label of
   * the page it turns back to.
   */
  readonly sealsPage = signal<Type<unknown> | undefined>(undefined);
}

/** How a feature adds its entries to the shell, from its providers. */
export function provideShellEntries(
  register: (shell: ShellRegistry) => void,
): EnvironmentProviders {
  return provideAppInitializer(() => register(inject(ShellRegistry)));
}

/** The shell's own commands. */
export function provideShell(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const facing = inject(Facing);
    shell.commands.add({
      id: 'shell.index',
      label: 'Index',
      plainLabel: 'Command palette',
      shortcut: 'Mod+K',
      run: () => facing.openIndex(),
    });
    const chats = inject(Chats);
    shell.commands.add({
      id: 'chapters.new',
      label: 'New chapter',
      plainLabel: 'New chat',
      hint: () => {
        const preset = chats.startOf().preset;
        return preset ? `from the preset ${preset}` : 'with your last settings';
      },
      shortcut: 'Mod+N',
      run: () => chats.newChapter(),
    });
    // Focus mode in the Index: in, or back out to two pages.
    const focus = inject(Focus);
    const wording = inject(Wording);
    effect((onCleanup) => {
      onCleanup(
        focus.on()
          ? shell.commands.add({
              id: 'shell.twoPages',
              label: 'Two pages',
              plainLabel: 'Leave focus',
              hint: () =>
                wording.say(
                  'the facing page, thumb index and ribbons again',
                  'show everything again',
                ),
              run: () => focus.leave(),
            })
          : shell.commands.add({
              id: 'shell.singlePage',
              label: 'Single page',
              plainLabel: 'Focus mode',
              hint: () => wording.say('this chapter alone on the desk', 'only this chat'),
              run: () => focus.enter(),
            }),
      );
    });
    shell.commands.add({
      id: 'chapters.close',
      label: 'Close chapter',
      plainLabel: 'Close chat',
      shortcut: 'Mod+W',
      run: () => {
        const id = chats.currentId();
        if (id) void chats.close(id);
      },
    });
    noteWaitingChapters(shell);
  });
}
