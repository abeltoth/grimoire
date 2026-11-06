import {
  Component,
  DestroyRef,
  PendingTasks,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import type { SetupFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Facing } from './facing';
import { type Shortcut, ShortcutPipe, matchesShortcut } from './shortcut';

const SAVE: Shortcut = 'Mod+S';

/** Something said on the editor's last line: what came of a save, or why it can't be left yet. */
export interface EditorNote {
  text: string;
  alert?: boolean;
}

/**
 * A file opened on a thumb tab's page, to read or change in place as
 * written and save with Save or Ctrl+S. While it holds changes, neither
 * Esc nor the facing page turns away from it until they're saved or
 * discarded. What's put inside shows above the text; what's marked
 * `actions`, beside Save.
 */
@Component({
  selector: 'gr-file-editor',
  imports: [ShortcutPipe],
  host: { '(keydown)': 'key($event)' },
  templateUrl: './file-editor.html',
  styleUrl: './file-editor.css',
})
export class FileEditor {
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  private readonly pending = inject(PendingTasks);
  protected readonly chats = inject(Chats);

  /** The file as it was opened, or last saved; a new one takes the place of any changes. */
  readonly file = input.required<SetupFile>();
  /** What it is, or whose, said after its name. */
  readonly from = input('');
  /** Why it can only be read here; null when it can be changed. */
  readonly readOnly = input<string | null>(null);
  /** The link back to what it was opened from, such as "Back to the list". */
  readonly backLabel = input.required<string>();
  /** What's said once it's saved. */
  readonly savedNote = input('Saved.');
  /** Writes the text over the file as it was opened, and answers the file as it is then. */
  readonly write = input.required<(file: SetupFile, text: string) => Promise<SetupFile>>();

  /** Asks to turn back to what it was opened from; it only does when there's nothing to save. */
  readonly back = output<void>();
  readonly saved = output<SetupFile>();

  protected readonly save = SAVE;
  /** The file's text as you're changing it. */
  protected readonly draft = linkedSignal(() => this.file().text);
  readonly changed = computed(() => this.draft() !== this.file().text);
  protected readonly saving = signal(false);
  protected readonly note = signal<EditorNote | null>(null);

  constructor() {
    // Changes can't be left behind unsaved by turning the facing page away.
    const unguard = inject(Facing).guardLeaving(() => this.mayLeave());
    inject(DestroyRef).onDestroy(unguard);
  }

  /** Whether the file may be left: not while it holds changes to save or discard first. */
  mayLeave(): boolean {
    if (!this.changed()) return true;
    this.tell({ text: 'Save your changes, or discard them, first.', alert: true });
    return false;
  }

  /** Says something on the last line, such as why something done beside Save failed; null says nothing. */
  tell(note: EditorNote | null): void {
    this.note.set(note);
  }

  protected async keep(): Promise<void> {
    const file = this.file();
    if (this.readOnly() !== null || !this.changed() || this.saving()) return;
    this.saving.set(true);
    const done = this.pending.add();
    try {
      this.saved.emit(await this.write()(file, this.draft()));
      this.tell({ text: this.savedNote() });
    } catch (error) {
      this.tell({ text: error instanceof Error ? error.message : String(error), alert: true });
    } finally {
      this.saving.set(false);
      done();
    }
  }

  protected discard(): void {
    this.draft.set(this.file().text);
    this.tell(null);
  }

  protected close(): void {
    if (this.mayLeave()) this.back.emit();
  }

  /** Ctrl+S saves; Esc turns back to what it was opened from, not away from the page. */
  protected key(event: KeyboardEvent): void {
    if (matchesShortcut(event, SAVE, this.platform)) {
      event.preventDefault();
      void this.keep();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }
}
