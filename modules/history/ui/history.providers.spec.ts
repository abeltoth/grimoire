import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';
import { ChatTags } from './chat-tags';
import { Pins } from './pins';

describe('history.providers', () => {
  it('adds the Table of contents page tab, which turns the right page to the History', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Table of contents');
    expect(el.querySelector('gr-history-page')).not.toBeNull();
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['History']);
  });

  it('puts the pins on the chat’s corners and its tags after its title', async () => {
    const { bridge } = fakeBridge();
    await render(bridge);
    const shell = TestBed.inject(ShellRegistry);
    expect(shell.chatCorners.all().map((part) => part.component)).toContain(Pins);
    expect(shell.afterTitle.all().map((part) => part.component)).toContain(ChatTags);
  });
});
