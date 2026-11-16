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
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { ChatList } from '@ui/app/core/chat-list';
import { Wording } from '@ui/app/core/wording';
import { Focus } from '@ui/app/shell/focus';
import { Icon } from '@ui/design-system/icon';
import { FilesViews } from './files-views';
import { OpenFiles } from './open-files';
import { folderOf, nameOf, shownPath } from './paths';
import { fromFolder, touchedFiles } from './touched';

/**
 * The Files page: the open chat's folder, what's changed in it since the
 * last commit first, and its files as a tree, or found by name; or, a tab
 * away, the files the open chat's agent changed. Files open in tabs beside
 * it. A link lays it alone on a single page, in the chat's place.
 */
@Component({
  selector: 'gr-files-page',
  imports: [Icon, NgTemplateOutlet, OpenFiles],
  templateUrl: './files-page.html',
  styleUrl: './files-page.css',
})
export class FilesPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly views = inject(FilesViews);
  private readonly list = inject(ChatList);
  protected readonly focus = inject(Focus);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  protected readonly folderOf = folderOf;
  protected readonly nameOf = nameOf;

  /** The open chat's folder; your home folder until you pick another. */
  protected readonly cwd = this.views.cwd;
  protected readonly view = computed(() => this.views.of(this.cwd()));
  /** What isn't committed yet, as git tells it; none outside a repository. */
  protected readonly changes = signal<readonly GitChange[]>([]);
  /** The files the open chat's agent changed, the latest first, named in full. */
  protected readonly touched = computed(() => touchedFiles(this.list.current()?.entries ?? []));
  /** The changed files show in the folder's place while you've turned to them and there are some. */
  protected readonly touchedShown = computed(
    () => this.view().touchedShown() && this.touched().length > 0,
  );
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
      for (const tab of view.tabs()) void tab.file().changedAt;
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

  protected layAlone(): void {
    this.views.layAlone();
  }

  /** A file the agent changed, named from the folder when it's in it, or else in full. */
  protected touchedName(file: string): string {
    return shownPath(fromFolder(file, this.view().root()), this.catalog.folders().home);
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
