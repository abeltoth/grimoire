import { TestBed } from '@angular/core/testing';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { fakeBridge } from '@ui/testing/app-testing';
import { inputFields } from './tool-input';
import { ToolInputView } from './tool-input-view';

describe('ToolInputView', () => {
  async function view(input: Record<string, unknown>) {
    const { bridge } = fakeBridge();
    TestBed.configureTestingModule({ providers: [{ provide: GRIMOIRE_BRIDGE, useValue: bridge }] });
    const fixture = TestBed.createComponent(ToolInputView);
    fixture.componentRef.setInput('fields', inputFields(input));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const texts = (selector: string) =>
      [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
    const click = async (label: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((button) => button.textContent!.trim() === label)!
        .click();
      await fixture.whenStable();
    };
    return { bridge, el, texts, click };
  }

  it('sets the short fields in a grid and each long one apart', async () => {
    const { el, texts } = await view({
      url: 'https://x.dev',
      prompt: 'Find the signals\nand list them',
      retries: 2,
    });
    expect(texts('dt')).toEqual(['url', 'retries']);
    expect(texts('dd')).toEqual(['https://x.dev', '2']);
    expect(texts('.field .name')).toEqual(['prompt']);
    expect(texts('.field .plain')).toEqual(['Find the signals\nand list them']);
    expect(texts('.gr-link')).toEqual([]);
    expect(el.querySelector('.value')!.classList).not.toContain('folded');
  });

  it('sets markdown as the page text', async () => {
    const { texts } = await view({ body: '# Plan\n\n- **one**\n- two' });
    expect(texts('gr-markdown .heading')).toEqual(['Plan']);
    expect(texts('gr-markdown strong')).toEqual(['one']);
  });

  it('previews HTML as markdown, with its source a click away', async () => {
    const { el, texts, click } = await view({
      contentFormat: 'html',
      body: '<p>See <a href="https://x.dev">the <em>site</em></a> for more.</p><script>steal()</script>',
    });
    expect(texts('gr-markdown em')).toEqual(['site']);
    expect(el.querySelector('script')).toBeNull();

    await click('Source');
    expect(el.querySelector('gr-markdown')).toBeNull();
    expect(texts('.plain')[0]).toContain('<script>steal()</script>');
    await click('Preview');
    expect(texts('gr-markdown em')).toEqual(['site']);
  });

  it('reads a list of objects item by item, its first three until you ask for all', async () => {
    const edits = Array.from({ length: 5 }, (_, i) => ({
      name: 'replaceNode',
      localId: `id-${i}`,
      value: `<td><p>Cell <em>${i}</em> and some words to make it long enough to stand apart.</p></td>`,
    }));
    const { el, texts, click } = await view({ cloudId: 'fd4d', edits });
    expect(texts(':scope > .grid dt')).toEqual(['cloudId']);
    expect(texts(':scope > .field > .field-head .count')).toEqual(['5']);
    expect(el.querySelectorAll('.items > li')).toHaveLength(3);
    expect(texts('.items > li .grid dd').slice(0, 2)).toEqual(['replaceNode', 'id-0']);
    expect(texts('.items > li gr-markdown em')).toEqual(['0', '1', '2']);
    expect(el.querySelector('.items td')).toBeNull();

    await click('Show all 5 items');
    expect(el.querySelectorAll('.items > li')).toHaveLength(5);
    await click('Show less');
    expect(el.querySelectorAll('.items > li')).toHaveLength(3);
  });

  it('reads an object inside field by field', async () => {
    const { texts } = await view({
      page: { id: '42', body: 'Some words\nover two lines', more: 'x'.repeat(60) },
    });
    expect(texts('.field > gr-tool-input.nested .grid dt')).toEqual(['id', 'more']);
    expect(texts('.field > gr-tool-input.nested .field .name')).toEqual(['body']);
  });

  it('folds a long field until you ask for all of it', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const { el, click } = await view({ log: lines });
    expect(el.querySelector('.value')!.classList).toContain('folded');
    await click('Show all');
    expect(el.querySelector('.value')!.classList).not.toContain('folded');
    await click('Show less');
    expect(el.querySelector('.value')!.classList).toContain('folded');
  });
});
