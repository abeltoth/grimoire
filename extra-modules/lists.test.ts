import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extraModules } from './service';
import { extraProviders } from './ui';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const elsewhere = 'Pro modules register in the private repo’s extra-modules, never here';

describe('extra-modules', () => {
  it('lists no modules in the open-source build', () => {
    expect(extraModules, elsewhere).toEqual([]);
    expect(extraProviders, elsewhere).toEqual([]);
  });

  it('adds nothing to the contract or the theme', () => {
    expect(read('./contract.ts'), elsewhere).not.toMatch(/\bfrom\b/);
    expect(read('./theme.css'), elsewhere).not.toMatch(/@import|--gr-/);
  });
});
