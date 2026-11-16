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
import { ChatList } from '../core/chat-list';
import { AgentCommands } from './agent-commands';
import { noteWaitingChats } from './focus-notes';
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

/** A tab on the fore-edge that turns the right page to one of the book's pages. */
export interface PageTab extends Entry, Labelled {
  /** What the page shows; without it the page is blank, its feature not written yet. */
  component?: Type<unknown>;
}

/** Something the right page can show, picked from the tabs in its page header. */
export interface RightPageEntry extends Entry, Labelled {
  /** Without it the tab shows but can't be picked yet. */
  component?: Type<unknown>;
  /** A line for the page footer while it shows, such as "3 of 5 done". */
  foot?: () => string;
  /** What its tab says for now, such as the title of the chat it shows; its label when none. */
  heading?: () => string | undefined;
  /** It draws the whole page itself, its page header with the tabs and its foot. */
  whole?: boolean;
}

/** A status in the chat's page footer, such as the git branch. */
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

/** A badge in the chat's page header, such as its pull request's review. */
export interface Badge extends Entry {
  label: string;
  /** An alert is stamped in rubric, a quiet one in plain ink. */
  tone?: 'alert' | 'quiet';
  /** More about it, shown on hover. */
  detail?: string;
  open?: () => void;
}

/** Something drawn on the open chat's page, such as its tags; it takes the chat as its `chat` input. */
export interface ChatPart extends Entry {
  component: Type<unknown>;
}

/** A section of the Settings page, after the general settings, such as a feature's own. */
export interface SettingsSection extends Entry {
  component: Type<unknown>;
}

/** Something you can do with a shortcut. */
export interface Command extends Entry, Labelled {
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
 * The places in the shell that features fill: page tabs, right
 * pages, page-footer indicators, page-header badges, parts of the chat's
 * page, sections of the Settings page and commands. The shell draws whatever is registered here and knows
 * nothing about the features themselves.
 */
@Injectable({ providedIn: 'root' })
export class ShellRegistry {
  readonly pageTabs = new Slot<PageTab>();
  readonly rightPages = new Slot<RightPageEntry>();
  readonly indicators = new Slot<Indicator>();
  readonly badges = new Slot<Badge>();
  readonly commands = new Slot<Command>();
  /** On the open chat's page, over its corners, such as its pins; not on a chat beside it. */
  readonly chatCorners = new Slot<ChatPart>();
  /** After the open chat's title in its page header, such as its tags; not on a chat beside it. */
  readonly afterTitle = new Slot<ChatPart>();
  /** On the Settings page, after the model for quick tasks, such as when to label chats. */
  readonly settingsSections = new Slot<SettingsSection>();
  /** What the left page shows for the open chat: the chat module's page. */
  readonly chatPage = signal<Type<unknown> | undefined>(undefined);
  /**
   * What the right page shows when it's turned to the waiting approvals:
   * the chat module's page. It takes a `backTo` input, the label of
   * the page it turns back to.
   */
  readonly approvalsPage = signal<Type<unknown> | undefined>(undefined);
  /**
   * Opens a file on the Files page: at a line when one is given, or else
   * with its changes since the last commit if it has any; the files
   * module's. The path is in full, or from the open chat's folder.
   * Missing without the files module, so nothing offers to.
   */
  readonly openFile = signal<((path: string, line?: number) => void) | undefined>(undefined);
  /**
   * Writes text into the open chat's message, after what's there, such as
   * a part of a file from Files: the chat module's.
   */
  readonly addToChat = signal<((text: string) => void) | undefined>(undefined);
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
    const commands = inject(AgentCommands);
    shell.commands.add({
      id: 'shell.commandPalette',
      label: 'Index',
      plainLabel: 'Command palette',
      shortcut: 'Mod+K',
      run: () => commands.openPalette(),
    });
    const list = inject(ChatList);
    shell.commands.add({
      id: 'chats.new',
      label: 'New chapter',
      plainLabel: 'New chat',
      shortcut: 'Mod+N',
      run: () => list.newChat(),
    });
    shell.commands.add({
      id: 'chats.close',
      label: 'Close chapter',
      plainLabel: 'Close chat',
      shortcut: 'Mod+W',
      run: () => {
        const id = list.currentId();
        if (id) void list.close(id);
      },
    });
    noteWaitingChats(shell);
  });
}
