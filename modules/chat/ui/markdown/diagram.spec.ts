import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesignSettings } from '@ui/design-system/design-settings';
import { type DiagramLook, type Drawn, Diagrams } from './diagrams';
import { MarkdownView } from './markdown-view';

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
