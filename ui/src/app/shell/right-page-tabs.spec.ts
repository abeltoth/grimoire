import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Settings } from '../core/settings';
import { useFakeBridge } from '../../testing/app-testing';
import { Focus } from './focus';
import { RightPageState } from './right-page-state';
import { RightPageTabs } from './right-page-tabs';
import { ShellRegistry } from './shell-registry';

@Component({ template: '' })
class Outline {}

async function tabs() {
  useFakeBridge();
  const shell = TestBed.inject(ShellRegistry);
  shell.rightPages.add({ id: 'plan', label: 'Outline', plainLabel: 'Plan', component: Outline });
  shell.rightPages.add({ id: 'chat', label: 'Second chat', heading: () => 'Fix the ribbon' });
  shell.rightPages.add({ id: 'atlas', label: 'Atlas' });
  const fixture = TestBed.createComponent(RightPageTabs);
  fixture.componentRef.setInput('current', 'plan');
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());
  return { fixture, el, texts };
}

describe('RightPageTabs', () => {
  it('heads the right page with the tabs registered, the one showing pressed', async () => {
    const { fixture, texts } = await tabs();
    expect(texts('.tabs button')).toEqual(['Outline', 'Fix the ribbon', 'Atlas']);
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Outline']);
    expect(texts('.tabs [aria-disabled="true"]')).toEqual(['Fix the ribbon', 'Atlas']);
    expect(texts('.gr-link')).toEqual(['Single page']);

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('.tabs button')[0]).toBe('Plan');
    expect(texts('.gr-link')).toEqual(['Focus']);
  });

  it('turns the right page to a tab that can be picked, and to a single page', async () => {
    const { el } = await tabs();
    const state = TestBed.inject(RightPageState);
    const [plan, , atlas] = [...el.querySelectorAll<HTMLButtonElement>('.tabs button')];
    atlas!.click();
    expect(state.page()).toBeUndefined();
    plan!.click();
    expect(state.page()).toBe('plan');

    el.querySelector<HTMLButtonElement>('.gr-link')!.click();
    expect(TestBed.inject(Focus).on()).toBe(true);
  });
});
