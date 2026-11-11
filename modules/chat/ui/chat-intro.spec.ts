import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ApprovalMode } from '@grimoire/contract';
import { Settings } from '@ui/app/core/settings';
import { useFakeBridge } from '@ui/testing/app-testing';
import { ChatIntro } from './chat-intro';

@Component({
  imports: [ChatIntro],
  template: `<gr-chat-intro
    agentName="Claude Code"
    [cwd]="cwd()"
    [mode]="mode()"
    [begunAt]="begunAt"
    [error]="error()"
  />`,
})
class Host {
  readonly cwd = signal<string | undefined>('/work/grimoire');
  readonly mode = signal<ApprovalMode | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly begunAt = new Date(2026, 10, 10, 9, 5).getTime();
}

function intro() {
  useFakeBridge();
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement as HTMLElement;
  const text = (selector: string) =>
    el.querySelector(selector)?.textContent!.replace(/\s+/g, ' ').trim();
  return { fixture, el, text };
}

describe('ChatIntro', () => {
  it('says when the chat was begun, who writes it, and where and how it works', async () => {
    const { fixture, text } = intro();
    await fixture.whenStable();
    const time = new Date(fixture.componentInstance.begunAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(text('.kicker')).toBe('A new chapter');
    expect(text('.begun')).toBe(`Begun at ${time}, to be written by Claude Code`);
    expect(text('.note')).toBe(
      'Write your first entry on the page below. Claude Code works in /work/grimoire and asks before it edits a file or runs a command.',
    );
  });

  it('names your home folder and the mode it works in, plainly when asked', async () => {
    const { fixture, text } = intro();
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    fixture.componentInstance.cwd.set(undefined);
    fixture.componentInstance.mode.set('plan');
    await fixture.whenStable();
    expect(text('.kicker')).toBe('A new chat');
    expect(text('.note')).toBe(
      'Write your first message below. Claude Code works in your home folder and only reads and plans; it changes nothing.',
    );
  });

  it('says why the chat couldn’t start', async () => {
    const { fixture, el, text } = intro();
    fixture.componentInstance.error.set('Claude Code is not signed in');
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(text('.error')).toBe('Claude Code is not signed in');
  });
});
