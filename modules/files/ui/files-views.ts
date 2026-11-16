import {
  Injectable,
  PendingTasks,
  type WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { FolderEntry, OpenFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Focus } from '@ui/app/shell/focus';

/** How long typing has to pause before files are looked for, in ms. */
const FIND_AFTER_MS = 150;
/** How many files a folder keeps open at once: as many as the service watches. */
export const MOST_TABS = 8;

/** Something said on a file's last line, or over the folder: what came of a save, or of a change on disk. */
export interface FilesNote {
  text: string;
  alert?: boolean;
}

const UNSAVED: FilesNote = { text: 'Save your changes, or discard them, first.', alert: true };
const ALL_CHANGED: FilesNote = {
  text: 'Every file open holds changes not saved: save or discard one first.',
  alert: true,
};

/** A file open in a tab of its own, and your changes to it. */
export class FileTab {
  /** The file as it was opened or last saved. */
  readonly file: WritableSignal<OpenFile>;
  /** Its text as you're changing it. */
  readonly draft: WritableSignal<string>;
  /** Whether it shows its changes since the last commit, rather than just the file. */
  readonly changes: WritableSignal<boolean>;
  readonly note = signal<FilesNote | null>(null);
  readonly saving = signal(false);
  /** The file as it is on disk now, when it changed there under changes not saved; null otherwise. */
  readonly onDisk = signal<OpenFile | null>(null);
  /** Whether it shows your changes beside the file on disk, to choose between them. */
  readonly comparing = signal(false);
  /** Whether it shows as it reads, a Markdown file set as text or an SVG drawn, rather than its source. */
  readonly preview = signal(false);
  /** The line to turn to, asked for afresh each time, so the same line can be asked for twice. */
  readonly reveal = signal<{ line: number } | null>(null);

  readonly changed = computed(() => {
    const file = this.file();
    return !file.unshown && this.draft() !== file.text;
  });
  /** It shows its changes only while it has some since the last commit. */
  readonly showsChanges = computed(() => this.changes() && this.file().committed !== undefined);

  constructor(file: OpenFile, changes: boolean) {
    this.file = signal(file);
    this.draft = signal(file.text);
    this.changes = signal(changes);
  }

  /** How the page names it, which stays while it's open. */
  get path(): string {
    return this.file().path;
  }
}

/** A folder's Files page as you left it, kept while the right page shows another. */
export class FilesView {
  /** The folder the page shows, once it's read. */
  readonly root = signal<string | null>(null);
  /** Each folder's entries once read, by its path; the top folder's is ''. */
  readonly entries = signal<ReadonlyMap<string, readonly FolderEntry[]>>(new Map());
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** Why the folder couldn't be read. */
  readonly unread = signal<string | null>(null);
  readonly query = signal('');
  /** The files found for the words looked for; null when nothing is. */
  readonly found = signal<readonly string[] | null>(null);
  /** The files open, in the order of their tabs. */
  readonly tabs = signal<readonly FileTab[]>([]);
  /** The tab shown. */
  readonly active = signal<FileTab | null>(null);
  /** What came of opening a file, said over the folder. */
  readonly note = signal<FilesNote | null>(null);
  /** Whether the folder shows beside the open files; put away, it gives them the page. */
  readonly folderShown = signal(true);
  /** Whether the side shows the files the open chat's agent changed, rather than the folder. */
  readonly touchedShown = signal(false);

  /** Which search is the latest, the wait before it's made, and what's waiting on it. */
  finds = 0;
  findTimer?: ReturnType<typeof setTimeout>;
  findWait?: () => void;

  constructor(readonly cwd: string) {}
}

/**
 * The Files page's folders, each as you left it, in the background service
 * and the files on disk. A file open on it that changes on disk,
 * as when the agent edits it, is read again, unless you have changes to it.
 */
@Injectable({ providedIn: 'root' })
export class FilesViews {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly focus = inject(Focus);
  private readonly views = new Map<string, FilesView>();

  /** The folder the page shows: the open chat's; your home folder until you pick another. */
  readonly cwd = computed(() => this.list.current()?.settings.cwd ?? this.catalog.folders().home);

  constructor() {
    this.bridge.on('files.changed', ({ root, path }) => {
      for (const view of this.views.values()) {
        if (view.root() !== root) continue;
        const tab = view.tabs().find((open) => open.path === path);
        if (tab) void this.reload(view, tab);
      }
    });
  }

  /** Lays the book at a single page with Files alone on it, in the chat's place. */
  layAlone(): void {
    this.focus.enter();
    if (this.focus.on()) this.focus.lay('files');
  }

  of(cwd: string): FilesView {
    let view = this.views.get(cwd);
    if (!view) {
      view = new FilesView(cwd);
      this.views.set(cwd, view);
    }
    return view;
  }

  /** Reads a folder's entries; the top folder's when none is named. */
  async read(view: FilesView, folder = ''): Promise<void> {
    const done = this.pending.add();
    try {
      const list = await this.bridge.invoke('files.list', { cwd: view.cwd, path: folder });
      view.root.set(list.root);
      view.entries.update((entries) => new Map(entries).set(folder, list.entries));
      if (!folder) view.unread.set(null);
    } catch (error) {
      if (!folder) view.unread.set(messageOf(error));
    } finally {
      done();
    }
  }

  /** Expands a folder, reading it the first time, or collapses it. */
  toggle(view: FilesView, folder: string): void {
    const open = view.expanded().has(folder);
    view.expanded.update((expanded) => {
      const next = new Set(expanded);
      if (open) next.delete(folder);
      else next.add(folder);
      return next;
    });
    if (!open && !view.entries().has(folder)) void this.read(view, folder);
  }

  /** Looks for files with all the words in their paths, once typing pauses. */
  find(view: FilesView, query: string): void {
    view.query.set(query);
    clearTimeout(view.findTimer);
    view.findWait?.();
    view.findWait = undefined;
    const find = ++view.finds;
    if (!query.trim()) {
      view.found.set(null);
      return;
    }
    const done = (view.findWait = this.pending.add());
    view.findTimer = setTimeout(async () => {
      view.findWait = undefined;
      try {
        const found = await this.bridge
          .invoke('files.find', { cwd: view.cwd, query })
          .catch(() => []);
        if (find === view.finds) view.found.set(found);
      } finally {
        done();
      }
    }, FIND_AFTER_MS);
  }

  /**
   * Opens a file in a tab of its own, with its changes since the last commit
   * if asked and it has any, or turns to its tab when it's open already;
   * at a line when one is given.
   * With every tab taken, the first without changes to save makes room.
   */
  async open(view: FilesView, path: string, changes = false, line?: number): Promise<void> {
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('files.open', { cwd: view.cwd, path });
      view.note.set(null);
      const open = view.tabs().find((tab) => tab.path === file.path);
      if (open) {
        if (changes) {
          open.changes.set(true);
          open.preview.set(false);
        }
        if (line) open.reveal.set({ line });
        view.active.set(open);
        return;
      }
      if (view.tabs().length >= MOST_TABS) {
        const spare = view.tabs().find((tab) => !tab.changed());
        if (!spare) {
          view.note.set(ALL_CHANGED);
          this.unwatch(view, file.path);
          return;
        }
        this.remove(view, spare);
      }
      const tab = new FileTab(file, changes);
      if (line) tab.reveal.set({ line });
      view.tabs.update((tabs) => [...tabs, tab]);
      view.active.set(tab);
    } catch (error) {
      view.note.set({ text: messageOf(error), alert: true });
    } finally {
      done();
    }
  }

  async save(view: FilesView, tab: FileTab): Promise<void> {
    const file = tab.file();
    if (!tab.changed() || tab.saving()) return;
    tab.saving.set(true);
    const done = this.pending.add();
    try {
      const saved = await this.bridge.invoke('files.save', {
        cwd: view.cwd,
        path: file.path,
        text: tab.draft(),
        changedAt: file.changedAt,
      });
      tab.file.set(saved);
      tab.draft.set(saved.text);
      tab.note.set({ text: 'Saved.' });
    } catch (error) {
      tab.note.set({ text: messageOf(error), alert: true });
    } finally {
      tab.saving.set(false);
      done();
    }
  }

  discard(tab: FileTab): void {
    // Changes dropped, what's on disk now is what's left.
    if (tab.onDisk()) return this.takeDisk(tab);
    tab.draft.set(tab.file().text);
    tab.note.set(null);
  }

  /** Closes a file's tab, turning to the one beside it; not while it holds changes to save or discard. */
  close(view: FilesView, tab: FileTab): void {
    if (tab.changed()) {
      view.active.set(tab);
      tab.note.set(UNSAVED);
      return;
    }
    this.remove(view, tab);
  }

  private remove(view: FilesView, tab: FileTab): void {
    const tabs = view.tabs();
    const at = tabs.indexOf(tab);
    if (at < 0) return;
    const rest = tabs.filter((open) => open !== tab);
    view.tabs.set(rest);
    if (view.active() === tab) view.active.set(rest[Math.min(at, rest.length - 1)] ?? null);
    this.unwatch(view, tab.path);
  }

  /** Stops watching a file the page no longer shows. */
  private unwatch(view: FilesView, path: string): void {
    void this.bridge.invoke('files.close', { cwd: view.cwd, path }).catch(() => undefined);
  }

  /** Takes the file as it is on disk now, over your changes. */
  takeDisk(tab: FileTab): void {
    const disk = tab.onDisk();
    if (!disk) return;
    tab.file.set(disk);
    tab.draft.set(disk.text);
    this.settle(tab);
    tab.note.set({ text: 'Read again from disk.' });
  }

  /** Keeps your changes, to save over the file as it is on disk now. */
  keepMine(tab: FileTab): void {
    const disk = tab.onDisk();
    if (!disk) return;
    tab.file.set(disk);
    this.settle(tab);
    tab.note.set(null);
  }

  private settle(tab: FileTab): void {
    tab.onDisk.set(null);
    tab.comparing.set(false);
  }

  /**
   * The file as it is on disk now: over what's shown when you've changed
   * nothing, or else kept aside for you to take, compare or save over.
   */
  private async reload(view: FilesView, tab: FileTab): Promise<void> {
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('files.open', { cwd: view.cwd, path: tab.path });
      if (!view.tabs().includes(tab)) return;
      if (tab.changed()) {
        tab.onDisk.set(file);
        tab.note.set(null);
        return;
      }
      tab.file.set(file);
      tab.draft.set(file.text);
      this.settle(tab);
      tab.note.set({ text: 'It changed on disk, and was read again.' });
    } catch {
      if (view.tabs().includes(tab)) {
        tab.note.set({ text: 'It changed on disk, and couldn’t be read again.', alert: true });
      }
    } finally {
      done();
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
