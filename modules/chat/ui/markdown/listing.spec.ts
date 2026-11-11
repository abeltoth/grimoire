import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Highlighter } from './highlighter';
import { Listing } from './listing';

@Component({
  imports: [Listing],
  template: `<ng-template #quill><i class="quill">✒</i></ng-template>
    <gr-listing [code]="code()" [lang]="lang()" [number]="2" [open]="open()" [tail]="quill">
      <span class="extra">Source</span>
    </gr-listing>`,
})
class Host {
  readonly code = signal('const a = 1;\nconst b = 2;');
  readonly lang = signal('ts');
  readonly open = signal(false);
}

/** A listing whose colours come from `colours`, by language; plain where it gives none. */
function listing(colours: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Highlighter,
        useValue: {
          lines: (code: string, lang: string) =>
            colours[lang] &&
            code.split('\n').map((text) => [{ text, color: colours[lang], italic: lang === 'md' }]),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Listing', () => {
  it('is numbered like a figure, its lines numbered, with what’s put in it in its caption', async () => {
    const { fixture, el } = listing();
    await fixture.whenStable();
    expect(el.querySelector('figcaption')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Listing 2 · ts Source',
    );
    expect([...el.querySelectorAll('.number')].map((n) => n.textContent)).toEqual(['1', '2']);
    expect([...el.querySelectorAll('.line')].map((l) => l.textContent!.trim())).toEqual([
      'const a = 1;',
      'const b = 2;✒',
    ]);
    expect(el.querySelector('.code.open')).toBeNull();
  });

  it('colours its code once the highlighter has the language', async () => {
    const { fixture, el } = listing({ md: 'var(--gr-code-string)' });
    fixture.componentInstance.lang.set('md');
    await fixture.whenStable();
    const token = el.querySelector<HTMLElement>('.line span')!;
    expect(token.style.color).toBe('var(--gr-code-string)');
    expect(token.classList.contains('italic')).toBe(true);
  });

  it('keeps its foot open, with the quill on the last line, while it’s written', async () => {
    const { fixture, el } = listing();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(el.querySelector('.code.open')).not.toBeNull();
    expect(el.querySelectorAll('.line')[1]!.querySelector('.quill')).not.toBeNull();
  });
});
