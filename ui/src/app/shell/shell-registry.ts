import {
  type EnvironmentProviders,
  Injectable,
  type Type,
  computed,
  inject,
  provideAppInitializer,
  signal,
  untracked,
} from '@angular/core';
import type { IconName } from '../../design-system/icon';
import { Chats } from '../core/chats';
import type { Shortcut } from './shortcut';

interface Entry {
  id: string;
  /** Lower comes first; entries without one keep the order they were added in. */
  order?: number;
}

/** A tab on the fore-edge that opens one of the book's pages. */
export interface ThumbTab extends Entry {
  label: string;
  /** Without it the tab shows but does nothing yet. */
  open?: () => void;
}

/** Something the facing page can show, picked from the tabs in its running head. */
export interface FacingPageEntry extends Entry {
  label: string;
  /** Without it the tab shows but can't be picked yet. */
  component?: Type<unknown>;
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

/** Something you can do from the Index or with a shortcut. */
export interface Command extends Entry {
  label: string;
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
 * pages, running-foot indicators and commands. The shell draws whatever is
 * registered here and knows nothing about the features themselves.
 */
@Injectable({ providedIn: 'root' })
export class ShellRegistry {
  readonly thumbs = new Slot<ThumbTab>();
  readonly facingPages = new Slot<FacingPageEntry>();
  readonly indicators = new Slot<Indicator>();
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
    shell.commands.add({ id: 'shell.index', label: 'Index', shortcut: 'Mod+K' });
    const chats = inject(Chats);
    shell.commands.add({
      id: 'chapters.new',
      label: 'New chapter',
      shortcut: 'Mod+N',
      run: () => chats.newChapter(),
    });
    shell.commands.add({
      id: 'chapters.close',
      label: 'Close chapter',
      shortcut: 'Mod+W',
      run: () => {
        const id = chats.currentId();
        if (id) void chats.close(id);
      },
    });
  });
}
