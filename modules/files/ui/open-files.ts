import { NgComponentOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';
import { Focus } from '@ui/app/shell/focus';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { type Shortcut, ShortcutPipe } from '@ui/app/shell/shortcut';
import { Icon } from '@ui/design-system/icon';
import { CodeEditor, type FilePart } from './code-editor';
import { type FileTab, type FilesView, FilesViews } from './files-views';
import { folderOf, nameOf, shownPath } from './paths';

type Mode = 'file' | 'changes' | 'preview';

/**
 * The files open on the Files page: their tabs, and the one shown in the
 * VS Code editor to read and change, its changes since the last commit
 * beside it if you like, a part of it to add to the chat. A picture
 * shows; Markdown and SVG can show as they read.
 */
@Component({
  selector: 'gr-open-files',
  imports: [CodeEditor, Icon, NgComponentOutlet, ShortcutPipe],
  templateUrl: './open-files.html',
  styleUrl: './open-files.css',
})
export class OpenFiles {
  readonly view = input.required<FilesView>();

  private readonly views = inject(FilesViews);
  private readonly catalog = inject(AgentCatalog);
  protected readonly focus = inject(Focus);
  protected readonly shell = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly saveKey: Shortcut = 'Mod+S';
  protected readonly folderOf = folderOf;
  protected readonly nameOf = nameOf;

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

  protected shownPath(path: string): string {
    return shownPath(path, this.catalog.folders().home);
  }

  /** How a file can show as it reads: Markdown set as text, where the chat's view of it is, or an SVG drawn. */
  protected previewOf(path: string): 'markdown' | 'svg' | null {
    const name = path.toLowerCase();
    if (name.endsWith('.svg')) return 'svg';
    if (/\.(md|markdown)$/.test(name) && this.shell.markdownView()) return 'markdown';
    return null;
  }

  protected modeOf(tab: FileTab): Mode {
    if (tab.preview()) return 'preview';
    return tab.showsChanges() ? 'changes' : 'file';
  }

  protected show(tab: FileTab, mode: Mode): void {
    tab.preview.set(mode === 'preview');
    tab.changes.set(mode === 'changes');
  }

  /** An SVG's text as a picture's address, drawn as an image, where its scripts don't run. */
  protected drawing(text: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
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
}
