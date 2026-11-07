import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';
import type { FolderEntry, OpenFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';

/** How long typing has to pause before files are looked for, in ms. */
const FIND_AFTER_MS = 150;

/** Something said on the file's last line: what came of a save, or of a change on disk. */
export interface FilesNote {
  text: string;
  alert?: boolean;
}

/** A folder's Files page as you left it, kept while the facing page shows another. */
export class FilesView {
  /** The folder the page shows, once it's read. */
  readonly root = signal<string | null>(null);
  /** Each folder's entries once read, by its path; the top folder's is ''. */
  readonly entries = signal<ReadonlyMap<string, readonly FolderEntry[]>>(new Map());
  readonly unfolded = signal<ReadonlySet<string>>(new Set());
  /** Why the folder couldn't be read. */
  readonly unread = signal<string | null>(null);
  readonly query = signal('');
  /** The files found for the words looked for; null when nothing is. */
  readonly found = signal<readonly string[] | null>(null);
  /** The file open, as it was opened or last saved. */
  readonly file = signal<OpenFile | null>(null);
  /** Its text as you're changing it. */
  readonly draft = signal('');
  /** Whether it shows its changes since the last commit, rather than just the file. */
  readonly changes = signal(false);
  readonly note = signal<FilesNote | null>(null);
  readonly saving = signal(false);

  readonly changed = computed(() => {
    const file = this.file();
    return !!file && !file.unshown && this.draft() !== file.text;
  });
  /** It shows its changes only while it has some since the last commit. */
  readonly showsChanges = computed(() => this.changes() && this.file()?.committed !== undefined);

  /** Which search is the latest, the wait before it's made, and what's waiting on it. */
  finds = 0;
  findTimer?: ReturnType<typeof setTimeout>;
  findWait?: () => void;

  constructor(readonly cwd: string) {}
}

/**
 * The Files page's folders, each as you left it, in the background service
 * (ADR-009) and the files on disk. A file open on it that changes on disk,
 * as when the agent edits it, is read again over what's shown.
 */
@Injectable({ providedIn: 'root' })
export class FilesViews {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly views = new Map<string, FilesView>();

  constructor() {
    this.bridge.on('files.changed', ({ root, path }) => {
      for (const view of this.views.values()) {
        if (view.root() === root && view.file()?.path === path) void this.reload(view);
      }
    });
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

  /** Folds a folder out, reading it the first time, or back in. */
  toggle(view: FilesView, folder: string): void {
    const open = view.unfolded().has(folder);
    view.unfolded.update((unfolded) => {
      const next = new Set(unfolded);
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

  /** Opens a file, with its changes since the last commit if asked and it has any. */
  async open(view: FilesView, path: string, changes = false): Promise<void> {
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('files.open', { cwd: view.cwd, path });
      view.file.set(file);
      view.draft.set(file.text);
      view.changes.set(changes);
      view.note.set(null);
    } catch (error) {
      view.note.set({ text: messageOf(error), alert: true });
    } finally {
      done();
    }
  }

  async save(view: FilesView): Promise<void> {
    const file = view.file();
    if (!file || !view.changed() || view.saving()) return;
    view.saving.set(true);
    const done = this.pending.add();
    try {
      const saved = await this.bridge.invoke('files.save', {
        cwd: view.cwd,
        path: file.path,
        text: view.draft(),
        changedAt: file.changedAt,
      });
      view.file.set(saved);
      view.draft.set(saved.text);
      view.note.set({ text: 'Saved.' });
    } catch (error) {
      view.note.set({ text: messageOf(error), alert: true });
    } finally {
      view.saving.set(false);
      done();
    }
  }

  discard(view: FilesView): void {
    const file = view.file();
    if (file) view.draft.set(file.text);
    view.note.set(null);
  }

  /** Closes the file and turns back to the folder; not while it holds changes to save or discard. */
  close(view: FilesView): void {
    const file = view.file();
    if (!file) return;
    if (view.changed()) {
      view.note.set({ text: 'Save your changes, or discard them, first.', alert: true });
      return;
    }
    view.file.set(null);
    view.draft.set('');
    view.note.set(null);
    void this.bridge
      .invoke('files.close', { cwd: view.cwd, path: file.path })
      .catch(() => undefined);
  }

  /** The file as it is on disk now, over what's shown, changes and all. */
  private async reload(view: FilesView): Promise<void> {
    const shown = view.file();
    if (!shown) return;
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('files.open', { cwd: view.cwd, path: shown.path });
      if (view.file()?.path !== shown.path) return;
      view.file.set(file);
      view.draft.set(file.text);
      view.note.set({ text: 'It changed on disk, and was read again.' });
    } catch {
      if (view.file()?.path === shown.path) {
        view.note.set({ text: 'It changed on disk, and couldn’t be read again.', alert: true });
      }
    } finally {
      done();
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
