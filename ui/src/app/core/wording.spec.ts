import { TestBed } from '@angular/core/testing';
import { useFakeBridge } from '../../testing/app-testing';
import { Settings } from './settings';
import { Wording } from './wording';

describe('Wording', () => {
  it('says things in the book’s words, or plainly once Settings says so', () => {
    useFakeBridge();
    const wording = TestBed.inject(Wording);
    const entry = { label: 'Colophon', plainLabel: 'Settings' };
    expect(wording.say('chapter', 'chat')).toBe('chapter');
    expect(wording.label(entry)).toBe('Colophon');
    expect(wording.untitled()).toBe('Untitled chapter');
    expect(wording.back('Plan')).toBe('Back to the Plan');

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    expect(wording.say('chapter', 'chat')).toBe('chat');
    expect(wording.label(entry)).toBe('Settings');
    expect(wording.label({ label: 'Ledger' })).toBe('Ledger');
    expect(wording.untitled()).toBe('Untitled chat');
    expect(wording.back('Plan')).toBe('Back to Plan');
  });
});
