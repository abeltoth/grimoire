import { type EnvironmentProviders, effect, inject } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { RightPageState } from '@ui/app/shell/right-page/right-page-state';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { NoteList, splitNote } from './notes';
import { NotesPage } from './notes-page';

/**
 * The notes module: its page tab turns the right page to the
 * notes, New note writes one from anywhere, the page footer counts the
 * reminders due, and a chat whose agent made notes bears a badge for them.
 */
export function provideNotes(): EnvironmentProviders {
  return provideShellEntries((shell) => {
    const notes = inject(NoteList);
    const rightPage = inject(RightPageState);
    const wording = inject(Wording);
    const open = () => rightPage.openPageTab('notes');
    shell.pageTabs.add({
      id: 'notes',
      label: 'Marginalia',
      plainLabel: 'Notes',
      order: 25,
      component: NotesPage,
    });
    shell.commands.add({
      id: 'notes.new',
      label: 'New note',
      shortcut: 'Mod+Shift+N',
      run: () => {
        notes.composing.set(true);
        open();
      },
    });

    effect((onCleanup) => {
      const due = notes.due();
      if (!due.length) return;
      onCleanup(
        shell.indicators.add({
          id: 'notes.due',
          label: due.length === 1 ? '1 reminder due' : `${due.length} reminders due`,
          icon: 'bell',
          tone: 'alert',
          order: 15,
          detail: due.map((note) => splitNote(note.text).title).join('\n'),
          open,
        }),
      );
    });

    effect((onCleanup) => {
      const made = notes.ofCurrentChat();
      if (!made.length) return;
      onCleanup(
        shell.badges.add({
          id: 'notes.chat',
          label: made.length === 1 ? '1 note' : `${made.length} notes`,
          tone: 'quiet',
          order: 20,
          detail: wording.say(
            `Notes made in this chapter: ${made.map((note) => splitNote(note.text).title).join('; ')}`,
            `Notes made in this chat: ${made.map((note) => splitNote(note.text).title).join('; ')}`,
          ),
          open,
        }),
      );
    });
  });
}
