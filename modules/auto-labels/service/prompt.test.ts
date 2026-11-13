import { describe, expect, it } from 'vitest';
import type { Entry } from '@grimoire/contract';
import { chatText, labelPrompt, readLabels, readSuggestions, titlesText } from './prompt';

const you = (id: string, text: string): Entry => ({ kind: 'user', id, text });
const agent = (id: string, text: string): Entry => ({
  kind: 'agent',
  id,
  blocks: [{ kind: 'text', text }],
});
const all = { title: true, summary: true, tags: ['bug', 'UI'] };

describe('labelPrompt', () => {
  it('asks only for the labels wanted, with the tags it may pick from', () => {
    const prompt = labelPrompt(all);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('The list: bug, UI.');
    const titleOnly = labelPrompt({ title: true, summary: false, tags: [] });
    expect(titleOnly).toContain('"title"');
    expect(titleOnly).not.toContain('"summary"');
    expect(titleOnly).not.toContain('"tags"');
  });
});

describe('chatText', () => {
  it('reads the title, your first message and the latest few, each cut short', () => {
    const entries = [
      you('u1', 'Add a context meter'),
      ...Array.from({ length: 8 }, (_, i) => agent(`a${i}`, `Step ${i}`)),
      you('u2', 'x'.repeat(1000)),
    ];
    const text = chatText('Context meter', entries);
    expect(text).toContain('Title so far: Context meter');
    expect(text).toContain('First message:\nYou: Add a context meter');
    expect(text).not.toContain('Step 2');
    expect(text).toContain('Agent: Step 7');
    expect(text).toContain(`You: ${'x'.repeat(800)}…`);
  });

  it('leaves out what a chat doesn’t have yet', () => {
    expect(chatText('', [you('u1', 'Hello')])).toBe('First message:\nYou: Hello');
  });
});

describe('readLabels', () => {
  it('reads the labels from the answer, whatever is written around them', () => {
    const answer =
      '```json\n{"title": " Context meter ", "summary": "Adds a meter.", "tags": ["ui", "Bug", "ui", "docs"]}\n```';
    expect(readLabels(answer, all)).toEqual({
      title: 'Context meter',
      summary: 'Adds a meter.',
      tags: ['UI', 'bug'],
    });
  });

  it('keeps only the labels wanted, and nothing from an answer it can’t read', () => {
    expect(
      readLabels('{"title": "A", "summary": "B", "tags": ["bug"]}', {
        title: false,
        summary: true,
        tags: [],
      }),
    ).toEqual({ summary: 'B', tags: [] });
    expect(readLabels('I would call it "Context meter"', all)).toEqual({ tags: [] });
    expect(readLabels('{"title": 3, "tags": "bug"}', all)).toEqual({ tags: [] });
  });
});

describe('suggestions', () => {
  it('reads the titles one a line, and the tags suggested, lowercase and each once', () => {
    expect(titlesText([' Context meter ', '', 'Login test'])).toBe('Context meter\nLogin test');
    expect(readSuggestions('Here: ["Bug", "ui", "bug", 3, " "]')).toEqual(['bug', 'ui']);
    expect(readSuggestions('none')).toEqual([]);
  });
});
