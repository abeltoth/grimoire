import { Component, PendingTasks, inject, input, output, signal, viewChild } from '@angular/core';
import type { AgentInfo, Memory, SetupFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { FileEditor } from '@ui/app/shell/file-editor';
import { type Related, message } from './memory-map';

/** A memory open to read, change or delete. */
export interface Editing {
  agent: AgentInfo;
  /** The folder the agent keeps it for. */
  cwd: string;
  file: SetupFile;
  /** Its kind, as its column is titled. */
  kind: string;
}

/**
 * A memory open in place of the map: to read, change or delete, with the
 * memories it links with either way, each a turn to that memory.
 */
@Component({
  selector: 'gr-memory-editor',
  imports: [FileEditor],
  templateUrl: './memory-editor.html',
  styleUrls: ['./memory-asides.css', './memory-editor.css'],
})
export class MemoryEditor {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);

  readonly edit = input.required<Editing>();
  readonly related = input.required<Related>();
  readonly saved = output<SetupFile>();
  readonly back = output<void>();
  /** A memory it's linked with to open instead, once there's nothing to save. */
  readonly turnTo = output<Memory>();
  /** The memory was deleted, with its line in the index. */
  readonly removed = output<void>();

  private readonly editor = viewChild(FileEditor);
  /** Whether you're asked to make sure of deleting the memory. */
  protected readonly deleting = signal(false);

  /** Whether the memory is changed and not yet saved. */
  changed(): boolean {
    return !!this.editor()?.changed();
  }

  /** Forgets asking to delete, and what the editor last said, as for another memory. */
  reset(): void {
    this.deleting.set(false);
    this.editor()?.tell(null);
  }

  protected turn(memory: Memory): void {
    if (this.editor()?.mayLeave()) this.turnTo.emit(memory);
  }

  /** Writes the memory over the file as it was opened. */
  protected readonly writeMemory = (file: SetupFile, text: string): Promise<SetupFile> => {
    const edit = this.edit();
    return this.bridge.invoke('memories.save', {
      agent: edit.agent.id,
      cwd: edit.cwd,
      path: file.path,
      text,
      changedAt: file.changedAt,
    });
  };

  /** Deletes the memory and its line in the index. */
  protected async remove(): Promise<void> {
    const edit = this.edit();
    const done = this.pending.add();
    try {
      await this.bridge.invoke('memories.delete', {
        agent: edit.agent.id,
        cwd: edit.cwd,
        path: edit.file.path,
        changedAt: edit.file.changedAt,
      });
      this.removed.emit();
    } catch (error) {
      this.editor()?.tell({ text: `It couldn’t be deleted: ${message(error)}`, alert: true });
    } finally {
      this.deleting.set(false);
      done();
    }
  }
}
