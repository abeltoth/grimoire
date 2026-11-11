import { describe, expect, it } from 'vitest';
import { PERSONAL_PROFILE } from '@grimoire/contract';
import { openDatabase } from '../storage/database';
import { activeProfile, setActiveProfile } from './app-state';

describe('the active profile', () => {
  it('is the personal one until another is set, then the last one set', () => {
    const db = openDatabase(':memory:');
    expect(activeProfile(db)).toBe(PERSONAL_PROFILE);
    setActiveProfile(db, 'work');
    setActiveProfile(db, 'club');
    expect(activeProfile(db)).toBe('club');
  });
});
