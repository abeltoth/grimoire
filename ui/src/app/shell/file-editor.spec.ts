import { TestBed } from '@angular/core/testing';
import type { SetupFile } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { FileEditor } from './file-editor';
import { RightPageState } from './right-page/right-page-state';

const opened: SetupFile = {
  path: 'C:/Users/me/.claude/CLAUDE.md',
  text: 'Short answers.',
  exists: true,
  changedAt: 100,
  editable: true,
};

async function editor(write: (file: SetupFile, text: string) => Promise<SetupFile>) {
  useFakeBridge();
  const fixture = TestBed.createComponent(FileEditor);
  fixture.componentRef.setInput('file', opened);
  fixture.componentRef.setInput('backLabel', 'Back to the list');
  fixture.componentRef.setInput('write', write);
  const backs: number[] = [];
  const saved: SetupFile[] = [];
  fixture.componentInstance.back.subscribe(() => backs.push(1));
  fixture.componentInstance.saved.subscribe((file) => saved.push(file));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const text = el.querySelector<HTMLTextAreaElement>('textarea')!;
  const type = async (value: string) => {
    text.value = value;
    text.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const press = async (key: string, ctrlKey = false) => {
    text.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  };
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  const button = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent!.trim().startsWith(label),
    )!;
  return { fixture, el, text, type, press, texts, button, backs, saved };
}

describe('FileEditor', () => {
  it('saves what you change with Ctrl+S, and says so', async () => {
    const write = vi.fn(async (file: SetupFile, text: string) => ({ ...file, text }));
    const { type, press, texts, saved } = await editor(write);
    await type('Shorter answers.');
    await press('s', true);
    expect(write).toHaveBeenCalledWith(opened, 'Shorter answers.');
    expect(saved.map(({ text }) => text)).toEqual(['Shorter answers.']);
    expect(texts('.note')).toEqual(['Saved.']);
  });

  it('says why a save failed, and keeps the changes', async () => {
    const { type, button, texts, text } = await editor(async () => {
      throw new Error('It changed on disk first');
    });
    await type('Shorter answers.');
    button('Save').click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(texts('.note.alert')).toEqual(['It changed on disk first']);
    expect(text.value).toBe('Shorter answers.');
  });

  it('keeps changes from being left by Esc or the right page, until they’re discarded', async () => {
    const { fixture, type, press, texts, button, backs, text } = await editor(async (f) => f);
    const rightPage = TestBed.inject(RightPageState);
    rightPage.openPageTab('memories');
    await type('Shorter answers.');

    rightPage.closePageTab();
    expect(rightPage.pageTab()).toBe('memories');
    await fixture.whenStable();
    expect(texts('.note.alert')).toEqual(['Save your changes, or discard them, first.']);
    await press('Escape');
    expect(backs).toEqual([]);

    button('Discard changes').click();
    await fixture.whenStable();
    expect(text.value).toBe('Short answers.');
    await press('Escape');
    expect(backs).toEqual([1]);
    rightPage.closePageTab();
    expect(rightPage.pageTab()).toBeNull();
  });

  it('only shows a file it can’t change, and why', async () => {
    const { fixture, el, texts } = await editor(async (f) => f);
    fixture.componentRef.setInput('readOnly', 'Your organization manages it');
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('textarea')!.readOnly).toBe(true);
    expect(texts('.why')).toEqual(['Your organization manages it']);
  });
});
