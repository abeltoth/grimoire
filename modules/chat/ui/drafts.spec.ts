import { TestBed } from '@angular/core/testing';
import { Drafts } from './drafts';

describe('Drafts', () => {
  it('keeps each chat’s unsent entry, and forgets one left blank', () => {
    const drafts = TestBed.inject(Drafts);
    const picture = { kind: 'picture' as const, mediaType: 'image/png', data: 'AA==' };
    drafts.keep('a', { text: 'Half a thought', attachments: [] });
    drafts.keep('b', { text: '', attachments: [picture] });
    expect(drafts.of('a')).toEqual({ text: 'Half a thought', attachments: [] });
    expect(drafts.of('b').attachments).toEqual([picture]);
    expect(drafts.of('c')).toEqual({ text: '', attachments: [] });

    drafts.keep('a', { text: '', attachments: [] });
    expect(drafts.of('a')).toEqual({ text: '', attachments: [] });
  });
});
