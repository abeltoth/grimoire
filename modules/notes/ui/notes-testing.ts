import type { CommandRequest, Note, NoteDraft } from '@grimoire/contract';
import { fakeBridge } from '@ui/testing/app-testing';

/** What the notes' specs share: notes the fake service keeps, and ways to read and work the page. */
export const note = (id: string, text: string, change: Partial<Note> = {}): Note => ({
  id,
  text,
  createdAt: 0,
  pinned: false,
  due: false,
  ...change,
});

/** A fake service keeping the notes as the service does, newest first, each change told to windows; a note saved isn't due, its reminder taken to be later. */
export function withNotes(start: Note[] = []) {
  const fake = fakeBridge();
  let notes = start;
  let next = start.length + 1;
  const changed = (all: Note[]) => {
    notes = all;
    fake.emit('notes.changed', { notes });
    return notes;
  };
  fake.answers['notes.list'] = () => notes;
  fake.answers['notes.save'] = ({ id, ...draft }: NoteDraft) =>
    changed(
      id
        ? notes.map((n) => {
            if (n.id !== id) return n;
            const { remindAt: _, ...rest } = n;
            return {
              ...rest,
              ...draft,
              due: false,
            };
          })
        : [note(`note-${next++}`, draft.text, draft), ...notes],
    );
  fake.answers['notes.done'] = ({ id, done }: CommandRequest<'notes.done'>) =>
    changed(
      notes.map((n) => {
        if (n.id !== id) return n;
        const { doneAt: _, ...open } = n;
        return done ? { ...open, due: false, doneAt: 1 } : open;
      }),
    );
  fake.answers['notes.remove'] = ({ id }: CommandRequest<'notes.remove'>) =>
    changed(notes.filter((n) => n.id !== id));
  fake.answers['kanban.save'] = () => [];
  return fake;
}

export async function openNotes(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement) {
  [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
    .find((tab) => tab.textContent!.trim() === 'Marginalia')!
    .click();
  await fixture.whenStable();
}

export const noteEl = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`gr-notes-page [data-note="${id}"]`)!;

export const button = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
  )!;

export const field = (el: Element, selector: string, value: string) => {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
