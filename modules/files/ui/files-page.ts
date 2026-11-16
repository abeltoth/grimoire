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
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { type Shortcut, ShortcutPipe } from '@ui/app/shell/shortcut';
import { Icon } from '@ui/design-system/icon';
import { CodeEditor, type FilePart } from './code-editor';
import { type FileTab, FilesViews } from './files-views';
import { fromFolder, touchedFiles } from './touched';

/**
 * The Files page: the open chat's folder, what's changed in it since
 * the last commit first, and those the open chat's agent changed; its
 * files as a tree, or found by name. Files
 * open in tabs beside it, each in the VS Code editor to read and change,
 * its changes since the last commit beside it if you like, a part of it
 * to add to the chat.
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
  private readonly list = inject(ChatList);
  private readonly focus = inject(Focus);
  protected readonly shell = inject(ShellRegistry);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  protected readonly saveKey: Shortcut = 'Mod+S';

  /** The open chat's folder; your home folder until you pick another. */
  protected readonly cwd = this.views.cwd;
  protected readonly view = computed(() => this.views.of(this.cwd()));
  /** What isn't committed yet, as git tells it; none outside a repository. */
  protected readonly changes = signal<readonly GitChange[]>([]);
  /** The files the open chat's agent changed, the latest first, named in full. */
  protected readonly touched = computed(() => touchedFiles(this.list.current()?.entries ?? []));
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

  protected pick(tab: FileTab): void {
    this.view().active.set(tab);
  }

  protected save(tab: FileTab): void {
    void this.views.save(this.view(), tab);
  }

  protected discard(tab: FileTab): void {
    this.views.discard(tab);
  }

  protected takeDisk(tab: FileTab): void {
    this.views.takeDisk(tab);
  }

  protected keepMine(tab: FileTab): void {
    this.views.keepMine(tab);
  }

  protected close(tab: FileTab): void {
    this.views.close(this.view(), tab);
  }

  protected showFolder(shown: boolean): void {
    this.view().folderShown.set(shown);
  }

  /** A file's path as the page names it: from the folder, or in full, from your home folder when it's in it. */
  protected shownPath(path: string): string {
    if (!/^([a-zA-Z]:)?\//.test(path)) return path;
    const home = this.catalog.folders().home.replaceAll('\\', '/').replace(/\/$/, '');
    return home && path.toLowerCase().startsWith(`${home.toLowerCase()}/`)
      ? `~${path.slice(home.length)}`
      : path;
  }

  /** A file the agent changed, named from the folder when it's in it. */
  protected touchedName(file: string): string {
    return this.shownPath(fromFolder(file, this.view().root()));
  }

  /** Writes part of a file into the chat's message, with where it's from; in focus mode the chat lies there again. */
  protected addToChat(tab: FileTab, part: FilePart): void {
    const add = this.shell.addToChat();
    if (!add) return;
    const lines = part.from === part.to ? `${part.from}` : `${part.from}-${part.to}`;
    const language = /\.(\w+)$/.exec(tab.path)?.[1] ?? '';
    // A fence longer than any run of backticks in the text, so the text can't close it.
    const longest = Math.max(0, ...(part.text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const where = '`' + `${this.shownPath(tab.path)}:${lines}` + '`';
    // A selection that takes its last line's end brings a line break the fence already makes.
    const text = part.text.replace(/\r?\n$/, '');
    add([where, '', `${fence}${language}`, text, fence].join('\n'));
    if (this.focus.on() && this.focus.alone() === 'files') this.focus.lay(null);
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
