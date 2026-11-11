import { beforeEach, describe, expect, it } from 'vitest';
import { ADD_NOTE_PROMPT, type AddNote, addNoteTool, reminderTime } from './add-note';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };

/** The notes the tool saved, each with the chat it was made in; like the notes, `add` turns away one without text. */
let added: Parameters<AddNote>[];
let add: AddNote;
beforeEach(() => {
  added = [];
  add = (draft, madeIn) => {
    if (!draft.text) throw new Error('A note needs some text');
    added.push([draft, madeIn]);
  };
});

describe('the add_note tool', () => {
  it('is named add_note, and is called only when the user asks', () => {
    const tool = addNoteTool(add);
    expect(tool.name).toBe('add_note');
    expect(tool.prompt).toBe(ADD_NOTE_PROMPT);
    expect(ADD_NOTE_PROMPT).toContain('only when the user asks for a note or a reminder');
  });

  it('saves a note tidied, made in the chat, and says so', () => {
    expect(addNoteTool(add).run({ text: ' Buy ink \n' }, chat)).toBe(
      "Saved the note in the user's notes.",
    );
    expect(added).toEqual([[{ text: 'Buy ink', pinned: false }, chat]]);
  });

  it('sets a reminder at the time given, in local time when it has no offset', async () => {
    const said = addNoteTool(add).run({ text: 'Check the PR', remindAt: '2026-11-14T09:00' }, chat);
    const at = new Date(2026, 10, 14, 9, 0).getTime();
    expect(added[0]![0].remindAt).toBe(at);
    expect(said).toBe(
      `Saved the note in the user's notes, with a reminder at ${new Date(at).toLocaleString()}.`,
    );
    await addNoteTool(add).run({ text: 'B', remindAt: '2026-11-14T09:00:00Z' }, chat);
    expect(added[1]![0].remindAt).toBe(Date.UTC(2026, 10, 14, 9));
    await addNoteTool(add).run({ text: 'C', remindAt: '  ' }, chat);
    expect(added[2]![0]).not.toHaveProperty('remindAt');
  });

  it('throws on a time it can’t read, a note turned away, or a chat not known yet', () => {
    expect(() => reminderTime('next Friday')).toThrow('"next Friday" isn\'t a date and time');
    expect(() => addNoteTool(add).run({ text: '  ' }, chat)).toThrow('A note needs some text');
    expect(() => addNoteTool(add).run({ text: 'A' }, undefined)).toThrow(
      'There is no chat to add the note in yet.',
    );
    expect(added).toEqual([]);
  });
});
