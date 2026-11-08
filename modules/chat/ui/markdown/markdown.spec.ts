import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesignSettings } from '@ui/design-system/design-settings';
import { type DiagramLook, type Drawn, Diagrams } from './diagrams';
import { Highlighter } from './highlighter';
import { closeUnfinished, parseMarkdown } from './markdown';
import { MarkdownView } from './markdown-view';

describe('parseMarkdown', () => {
  it('sets paragraphs, lists and inline marks as blocks', () => {
    const { blocks } = parseMarkdown(
      'The meter **reads** `usage` and [docs](https://x.dev):\n\n- shows *a share*\n- warns at 80%',
      false,
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'The meter ' },
          { kind: 'strong', inline: [{ kind: 'text', text: 'reads' }] },
          { kind: 'text', text: ' ' },
          { kind: 'code', text: 'usage' },
          { kind: 'text', text: ' and ' },
          { kind: 'link', href: 'https://x.dev', inline: [{ kind: 'text', text: 'docs' }] },
          { kind: 'text', text: ':' },
        ],
      },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            {
              kind: 'plain',
              inline: [
                { kind: 'text', text: 'shows ' },
                { kind: 'em', inline: [{ kind: 'text', text: 'a share' }] },
              ],
            },
          ],
          [{ kind: 'plain', inline: [{ kind: 'text', text: 'warns at 80%' }], end: true }],
        ],
      },
    ]);
  });

  it('numbers listings and knows one still being written', () => {
    const done = parseMarkdown('```ts\nconst a = 1;\n```\n\nThen:\n\n```\nb\n```', false);
    expect(done.listings).toBe(2);
    expect(done.blocks[0]).toEqual({
      kind: 'code',
      code: 'const a = 1;',
      lang: 'ts',
      open: false,
      listing: 0,
    });

    const writing = parseMarkdown('Here:\n\n```ts\nconst a', true);
    expect(writing.blocks.at(-1)).toEqual({
      kind: 'code',
      code: 'const a',
      lang: 'ts',
      open: true,
      listing: 0,
      end: true,
    });
  });

  it('reads tables, quotes and raw HTML as text', () => {
    const { blocks } = parseMarkdown(
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n> said\n\n<div>hi</div>',
      false,
    );
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'quote', 'raw']);
    expect(blocks[0]).toMatchObject({
      head: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      rows: [[[{ kind: 'text', text: '1' }], [{ kind: 'text', text: '2' }]]],
    });
    expect(blocks[2]).toMatchObject({ text: '<div>hi</div>', end: true });
  });
});

describe('closeUnfinished', () => {
  it('closes inline code and bold left open while writing', () => {
    expect(closeUnfinished('Use `usa')).toBe('Use `usa`');
    expect(closeUnfinished('It **mat')).toBe('It **mat**');
    expect(closeUnfinished('It **')).toBe('It ');
    expect(closeUnfinished('Done **here** and `x`.')).toBe('Done **here** and `x`.');
    expect(closeUnfinished('`a ** b')).toBe('`a ** b`');
  });

  it('leaves an open code fence alone', () => {
    expect(closeUnfinished('```ts\nconst `a')).toBe('```ts\nconst `a');
  });
});

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

@Component({
  imports: [MarkdownView],
  template: `<gr-markdown [text]="text()" [writing]="writing()" />`,
})
class Reply {
  readonly text = signal('');
  readonly writing = signal(false);
}

/** Mermaid can't lay out in jsdom: diagrams are drawn by a fake that says what it was asked. */
function drawing(
  answer: (code: string) => Drawn = () => ({
    svg: '<svg class="drawn"></svg>',
    id: 'gr-diagram-1',
  }),
) {
  const asked: { code: string; look: DiagramLook }[] = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Diagrams,
        useValue: {
          draw: async (code: string, look: DiagramLook) => {
            asked.push({ code, look });
            return answer(code);
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Reply);
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  return { fixture, el, texts, asked };
}

const FLOW = '```mermaid\ngraph TD\n  A --> B\n```';

describe('Diagram', () => {
  it('draws a Mermaid listing, numbered with the listings, its source a click away', async () => {
    const { fixture, el, texts, asked } = drawing();
    fixture.componentInstance.text.set('```ts\nconst a = 1;\n```\n\n' + FLOW);
    await fixture.whenStable();

    expect(asked.map((a) => a.code)).toEqual(['graph TD\n  A --> B']);
    expect(texts('gr-listing figcaption')).toEqual(['Listing 1 · ts']);
    expect(texts('gr-diagram figcaption')).toEqual(['Listing 2 · mermaid Source']);
    expect(el.querySelector('gr-diagram .diagram svg.drawn')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('gr-diagram figcaption button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-diagram svg')).toBeNull();
    expect(texts('gr-diagram gr-listing figcaption')).toEqual(['Listing 2 · mermaid Diagram']);
    expect(texts('gr-diagram gr-listing .line')).toEqual(['graph TD', 'A --> B']);

    el.querySelector<HTMLButtonElement>('gr-diagram figcaption button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-diagram svg.drawn')).not.toBeNull();
  });

  it('stays a listing while it is still being written', async () => {
    const { fixture, el, asked } = drawing();
    fixture.componentInstance.writing.set(true);
    fixture.componentInstance.text.set('```mermaid\ngraph TD\n  A -');
    await fixture.whenStable();
    expect(el.querySelector('gr-diagram')).toBeNull();
    expect(el.querySelector('gr-listing .code.open')).not.toBeNull();
    expect(asked).toEqual([]);

    fixture.componentInstance.text.set(FLOW);
    await fixture.whenStable();
    expect(el.querySelector('gr-diagram .diagram svg')).not.toBeNull();
  });

  it('shows the listing and why when Mermaid can’t read it', async () => {
    const { fixture, el, texts } = drawing(() => ({ problem: 'Parse error on line 2' }));
    fixture.componentInstance.text.set('```mermaid\ngraph TD\n  A -->\n```');
    await fixture.whenStable();
    expect(el.querySelector('gr-diagram svg')).toBeNull();
    expect(texts('gr-diagram gr-listing figcaption')).toEqual(['Listing 1 · mermaid']);
    expect(texts('gr-diagram .problem')).toEqual([
      'The diagram couldn’t be drawn: Parse error on line 2.',
    ]);
  });

  it('draws it again when the theme or a token of it changes', async () => {
    const { fixture, asked } = drawing();
    fixture.componentInstance.text.set(FLOW);
    await fixture.whenStable();
    expect(asked).toHaveLength(1);

    TestBed.inject(DesignSettings).themeName.set('night');
    await fixture.whenStable();
    TestBed.inject(DesignSettings).tokens.set({ '--gr-diagram-ink': '#123456' });
    await fixture.whenStable();
    expect(asked).toHaveLength(3);
  });
});
