import { describe, expect, it } from 'vitest';
import { ActiveProfile } from './active-profile';

describe('ActiveProfile', () => {
  it('tells only when another profile is put in use', () => {
    const active = new ActiveProfile();
    expect(active.changedTo('personal')).toBe(false);
    // A profile made, renamed or deleted: the one in use stays.
    expect(active.changedTo('personal')).toBe(false);
    expect(active.changedTo('work')).toBe(true);
    expect(active.changedTo('work')).toBe(false);
    expect(active.changedTo('personal')).toBe(true);
  });
});
