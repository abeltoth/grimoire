import type { ApprovalMode } from '@grimoire/contract';
import { modeName } from './modes';

describe('modeName', () => {
  it('names a permission mode, Ask first when none is set', () => {
    expect(modeName('plan')).toBe('Plan only');
    expect(modeName(undefined)).toBe('Ask first');
  });

  it('keeps the name of a mode it doesn’t know', () => {
    expect(modeName('auto' as ApprovalMode)).toBe('auto');
  });
});
