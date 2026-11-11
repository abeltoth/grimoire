import { TestBed } from '@angular/core/testing';
import { Highlighter } from './highlighter';

describe('Highlighter', () => {
  it('colours code with the design tokens once the language loads', async () => {
    const highlighter = TestBed.inject(Highlighter);
    expect(highlighter.lines('const a = "x"; // y', 'ts')).toBeUndefined();
    const lines = await vi.waitFor(
      () => highlighter.lines('const a = "x"; // y', 'ts') ?? Promise.reject(new Error('not yet')),
      { timeout: 5000 },
    );
    expect(lines).toEqual([
      [
        { text: 'const', color: 'var(--gr-code-keyword)', italic: false },
        { text: ' a = ', italic: false },
        { text: '"x"', color: 'var(--gr-code-string)', italic: false },
        { text: '; ', italic: false },
        { text: '// y', color: 'var(--gr-code-comment)', italic: true },
      ],
    ]);
  });

  it('leaves unknown languages plain', async () => {
    const highlighter = TestBed.inject(Highlighter);
    highlighter.lines('x', 'not-a-language');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(highlighter.lines('x', 'not-a-language')).toBeUndefined();
  });
});
