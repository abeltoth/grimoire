import {
  Component,
  DestroyRef,
  ElementRef,
  PendingTasks,
  ViewEncapsulation,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import type * as Monaco from 'monaco-editor';
import { bookLook } from './book-theme';
import { MONACO, type MonacoApi, languageOf } from './monaco';

/** Each file's models are named apart, so one closing can't take another's. */
let opened = 0;

/**
 * A file's text in the VS Code editor (Monaco), in the book's colours: on
 * its own, or beside the file as last committed, its changes marked and
 * the file still yours to change. Ctrl+S asks to save.
 */
@Component({
  selector: 'gr-code-editor',
  template: `
    @if (problem(); as problem) {
      <p class="none" role="alert">{{ problem }}</p>
    } @else if (!ready()) {
      <p class="none">Opening the VS Code editor…</p>
    }
    <div class="surface"></div>
  `,
  styleUrl: './code-editor.css',
  // Monaco builds its own elements, which the stylesheet has to reach.
  encapsulation: ViewEncapsulation.None,
})
export class CodeEditor {
  /** The file's path from the folder the page shows, which tells its language. */
  readonly path = input.required<string>();
  /** Its text, as you change it here, or as it's put in from outside. */
  readonly text = model.required<string>();
  /** Its text as last committed; null for a new file. Only shown with `changes`. */
  readonly committed = input<string | null | undefined>(undefined);
  /** Whether it shows beside the file as last committed. */
  readonly changes = input(false);
  readonly save = output<void>();

  private readonly load = inject(MONACO);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  protected readonly ready = signal(false);
  protected readonly problem = signal<string | null>(null);

  private monaco?: MonacoApi;
  private file?: Monaco.editor.ITextModel;
  private original?: Monaco.editor.ITextModel;
  private editor?: Monaco.editor.IStandaloneCodeEditor | Monaco.editor.IStandaloneDiffEditor;
  /** Set while the text is put in from outside, so that isn't told back as yours. */
  private putting = false;
  private destroyed = false;

  constructor() {
    const done = inject(PendingTasks).add();
    void this.start().finally(done);

    // Text put in from outside, as when the file changed on disk, replaces what's shown.
    effect(() => {
      const text = this.text();
      if (!this.ready() || !this.file || this.file.getValue() === text) return;
      untracked(() => this.put(text));
    });
    effect(() => {
      const committed = this.committed() ?? '';
      if (this.ready() && this.original && this.original.getValue() !== committed) {
        this.original.setValue(committed);
      }
    });
    effect(() => {
      const changes = this.changes();
      if (this.ready()) untracked(() => this.mount(changes));
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.editor?.dispose();
      this.file?.dispose();
      this.original?.dispose();
    });
  }

  private async start(): Promise<void> {
    try {
      const monaco = await this.load();
      if (this.destroyed) return;
      this.monaco = monaco;
      const look = bookLook(this.host);
      monaco.editor.defineTheme('grimoire', look.theme);
      const n = ++opened;
      const uri = (side: string) =>
        monaco.Uri.from({ scheme: 'grimoire', path: `/${n}/${side}/${this.path()}` });
      const language = languageOf(monaco, this.path());
      this.file = monaco.editor.createModel(this.text(), language, uri('file'));
      this.original = monaco.editor.createModel(this.committed() ?? '', language, uri('committed'));
      this.file.onDidChangeContent(() => {
        if (!this.putting) this.text.set(this.file!.getValue());
      });
      this.ready.set(true);
    } catch (error) {
      this.problem.set(
        `The VS Code editor couldn’t be opened: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** The editor alone, or beside the file as last committed. */
  private mount(changes: boolean): void {
    const monaco = this.monaco!;
    const surface = this.host.querySelector<HTMLElement>('.surface')!;
    const look = bookLook(this.host);
    const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
      theme: 'grimoire',
      fontFamily: look.fontFamily,
      fontSize: look.fontSize,
      lineHeight: look.lineHeight,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
    };
    const state = this.focused()?.saveViewState();
    this.editor?.dispose();
    let focused: Monaco.editor.IStandaloneCodeEditor;
    if (changes) {
      const diff = monaco.editor.createDiffEditor(surface, {
        ...options,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
      });
      diff.setModel({ original: this.original!, modified: this.file! });
      this.editor = diff;
      focused = diff.getModifiedEditor();
    } else {
      focused = monaco.editor.create(surface, { ...options, model: this.file! });
      this.editor = focused;
    }
    if (state) focused.restoreViewState(state);
    // Opened on its changes, it starts at the first of them.
    else if ('revealFirstDiff' in this.editor) this.editor.revealFirstDiff();
    focused.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => this.save.emit());
  }

  /** The editor that holds the file: the editor alone, or the diff's side that can be changed. */
  private focused(): Monaco.editor.IStandaloneCodeEditor | undefined {
    const editor = this.editor;
    if (!editor) return undefined;
    return 'getModifiedEditor' in editor ? editor.getModifiedEditor() : editor;
  }

  private put(text: string): void {
    const editor = this.focused();
    const state = editor?.saveViewState();
    this.putting = true;
    try {
      this.file!.setValue(text);
    } finally {
      this.putting = false;
    }
    if (state) editor!.restoreViewState(state);
  }
}
