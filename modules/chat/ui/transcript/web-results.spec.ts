import { TestBed } from '@angular/core/testing';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { fakeBridge } from '@ui/testing/app-testing';
import { WebResults } from './web-results';

describe('WebResults', () => {
  async function results(summary: string) {
    const { bridge } = fakeBridge();
    TestBed.configureTestingModule({ providers: [{ provide: GRIMOIRE_BRIDGE, useValue: bridge }] });
    const fixture = TestBed.createComponent(WebResults);
    fixture.componentRef.setInput('query', 'angular signals');
    fixture.componentRef.setInput('sources', [
      { title: 'Signals', url: 'https://www.angular.dev/guide/signals' },
      { title: 'A post', url: 'https://example.com/post' },
    ]);
    fixture.componentRef.setInput('summary', summary);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const texts = (selector: string) =>
      [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
    return { bridge, el, texts };
  }

  it('shows the query, the pages found by title and site, and the summary as markdown', async () => {
    const { el, texts } = await results('Signals hold **state**.');
    expect(el.getAttribute('aria-label')).toBe('Web search for angular signals');
    expect(texts('.head b')).toEqual(['angular signals']);
    expect(texts('.head .detail')).toEqual(['2 pages found']);
    expect(texts('.source .title')).toEqual(['Signals', 'A post']);
    expect(texts('.source .site')).toEqual(['angular.dev', 'example.com']);
    expect(texts('gr-markdown strong')).toEqual(['state']);
  });

  it('opens a page in your browser', async () => {
    const { bridge, el } = await results('');
    el.querySelectorAll<HTMLButtonElement>('.source')[1]!.click();
    expect(bridge.openExternal).toHaveBeenCalledWith('https://example.com/post');
    expect(el.querySelector('gr-markdown')).toBeNull();
  });
});
