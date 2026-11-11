import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Diagrams } from './diagrams';
import { MarkdownView } from './markdown-view';

@Component({
  imports: [MarkdownView],
  template: `<ng-template #quill><i class="quill">✒</i></ng-template>
    <gr-markdown
      [text]="text()"
      [writing]="writing()"
      [firstListing]="firstListing()"
      [tail]="quill"
    />`,
})
class Reply {
  readonly text = signal('');
  readonly writing = signal(false);
  readonly firstListing = signal(1);
}

function reply() {
  TestBed.configureTestingModule({
    providers: [{ provide: Diagrams, useValue: { draw: async () => ({ problem: 'Not here' }) } }],
  });
  const fixture = TestBed.createComponent(Reply);
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  return { fixture, el, texts };
}

describe('MarkdownView', () => {
  it('sets a reply as the page’s text, never as HTML', async () => {
    const { fixture, el, texts } = reply();
    fixture.componentInstance.text.set(
      '# Plan\n\nFirst **bold** and `code`, then [a link](https://example.com).\n\n' +
        '1. one\n2. two\n\n> quoted\n\n<div>raw</div>',
    );
    await fixture.whenStable();
    expect(texts('[role="heading"]')).toEqual(['Plan']);
    expect(texts('p strong')).toEqual(['bold']);
    expect(texts('p code')).toEqual(['code']);
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
    expect(texts('ol li')).toEqual(['one', 'two']);
    expect(texts('blockquote')).toEqual(['quoted']);
    expect(el.querySelector('div')).toBeNull();
    // The quill follows the last words, here the raw HTML's.
    expect(texts('.raw')).toEqual(['<div>raw</div>✒']);
  });

  it('numbers its listings after the chat’s listings before it', async () => {
    const { fixture, texts } = reply();
    fixture.componentInstance.text.set('```ts\nconst a = 1;\n```\n\n```\nplain\n```');
    fixture.componentInstance.firstListing.set(3);
    await fixture.whenStable();
    expect(texts('gr-listing figcaption')).toEqual(['Listing 3 · ts', 'Listing 4']);
  });

  it('closes half-written markdown while it’s written, with the quill after the last words', async () => {
    const { fixture, el, texts } = reply();
    fixture.componentInstance.writing.set(true);
    fixture.componentInstance.text.set('Some **bold');
    await fixture.whenStable();
    expect(texts('p strong')).toEqual(['bold']);
    expect(el.querySelectorAll('.quill')).toHaveLength(1);
    expect(el.querySelector('p .quill')).not.toBeNull();
  });
});
