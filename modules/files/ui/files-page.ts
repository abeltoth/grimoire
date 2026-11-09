import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { GitChange } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { type Shortcut, ShortcutPipe } from '@ui/app/shell/shortcut';
import { Icon } from '@ui/design-system/icon';
import { CodeEditor } from './code-editor';
import { FilesViews } from './files-views';

/**
 * The Files page: the open chat's folder, what's changed in it since
 * the last commit first, and its files as a tree, or found by name. A file
 * opens in the VS Code editor to read and change, its changes since the
 * last commit beside it if you like.
 */
@Component({
  selector: 'gr-files-page',
  imports: [CodeEditor, Icon, NgTemplateOutlet, ShortcutPipe],
  templateUrl: './files-page.html',
  styleUrl: './files-page.css',
})
export class FilesPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly views = inject(FilesViews);
  protected readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  protected readonly saveKey: Shortcut = 'Mod+S';

  /** The open chat's folder; your home folder until you pick another. */
  protected readonly cwd = this.views.cwd;
  protected readonly view = computed(() => this.views.of(this.cwd()));
  /** What isn't committed yet, as git tells it; none outside a repository. */
  protected readonly changes = signal<readonly GitChange[]>([]);
  /** Which read of the changes is the latest, so an earlier one answering late is dropped. */
  private reads = 0;

  constructor() {
    effect(() => {
      const view = this.view();
      untracked(() => {
        if (!view.entries().has('') && !view.unread()) void this.views.read(view);
      });
    });
    // Read again when the folder changes, a file is saved or changes on disk, and on turning back to the folder.
    effect(() => {
      const view = this.view();
      void view.file()?.changedAt;
      untracked(() => void this.readChanges(view.cwd));
    });
  }

  protected find(query: string): void {
    this.views.find(this.view(), query);
  }

  protected toggle(folder: string): void {
    this.views.toggle(this.view(), folder);
  }

  protected open(path: string, changes = false): void {
    void this.views.open(this.view(), path, changes);
  }

  protected save(): void {
    void this.views.save(this.view());
  }

  protected discard(): void {
    this.views.discard(this.view());
  }

  protected close(): void {
    this.views.close(this.view());
  }

  protected showChanges(changes: boolean): void {
    this.view().changes.set(changes);
  }

  /** A file's path as the page names it: from the folder, or in full, from your home folder when it's in it. */
  protected shownPath(path: string): string {
    if (!/^([a-zA-Z]:)?\//.test(path)) return path;
    const home = this.chats.folders().home.replaceAll('\\', '/').replace(/\/$/, '');
    return home && path.toLowerCase().startsWith(`${home.toLowerCase()}/`)
      ? `~${path.slice(home.length)}`
      : path;
  }

  /** The folder a file is in, with a slash; empty at the top. */
  protected folderOf(file: string): string {
    const slash = file.lastIndexOf('/');
    return slash < 0 ? '' : file.slice(0, slash + 1);
  }

  protected nameOf(file: string): string {
    return file.slice(file.lastIndexOf('/') + 1);
  }

  private async readChanges(cwd: string): Promise<void> {
    const read = ++this.reads;
    const done = this.pending.add();
    try {
      const status = cwd ? await this.bridge.invoke('git.status', { cwd }).catch(() => null) : null;
      if (read === this.reads) this.changes.set(status?.changes ?? []);
    } finally {
      done();
    }
  }
}
