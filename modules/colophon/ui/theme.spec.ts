import theme from '@ui/design-system/themes/grimoire.css' with { loader: 'text' };
import { MAIN_TOKENS, TEXT_SIZE, hexOf, isColour, lookUpTokens, pxOf, tokenGroups } from './theme';

describe('the theme’s tokens', () => {
  it('are read under their headings, with the notes on them', () => {
    const groups = tokenGroups(`/* The theme */
:root {
  /* Paper */
  --gr-page: #f3ebd9;
  --gr-page-facing: var(--gr-page);

  /* Terminal */
  --gr-size-terminal: 13px;
  /* Darkened until text reaches this contrast. */
  --gr-terminal-min-contrast: 3;
}`);
    expect(groups).toEqual([
      {
        title: 'Paper',
        tokens: [
          { name: '--gr-page', value: '#f3ebd9' },
          { name: '--gr-page-facing', value: 'var(--gr-page)' },
        ],
      },
      {
        title: 'Terminal',
        tokens: [
          { name: '--gr-size-terminal', value: '13px' },
          {
            name: '--gr-terminal-min-contrast',
            value: '3',
            note: 'Darkened until text reaches this contrast.',
          },
        ],
      },
    ]);
  });

  it('are all read from the theme, the main ones among them', () => {
    const groups = tokenGroups(theme);
    const names = groups.flatMap((group) => group.tokens.map((token) => token.name));
    expect(groups[0]!.title).toBe('Desk, binding and thumb index');
    expect(names.length).toBe((theme.match(/^\s*--gr-[a-z0-9-]+:/gm) ?? []).length);
    expect(new Set(names).size).toBe(names.length);
    for (const main of [...MAIN_TOKENS.map((token) => token.name), TEXT_SIZE]) {
      expect(names).toContain(main);
    }
  });

  it('are looked up by name, value or heading', () => {
    const groups = tokenGroups(theme);
    const found = (lookUp: string) =>
      lookUpTokens(groups, lookUp).flatMap((group) => group.tokens.map((token) => token.name));
    expect(found('RUBRIC')).toContain('--gr-rubric');
    expect(found('#f3ebd9')).toEqual(['--gr-page']);
    expect(lookUpTokens(groups, 'composer').map((group) => group.title)).toEqual([
      'Chat: composer',
    ]);
    expect(lookUpTokens(groups, '  ')).toHaveLength(groups.length);
  });

  it('say which values are colours and sizes', () => {
    expect(hexOf('#A5321E')).toBe('#a5321e');
    expect(hexOf('#abc')).toBe('#aabbcc');
    expect(hexOf('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(isColour('rgba(74, 48, 22, 0.14)')).toBe(true);
    expect(isColour('var(--gr-page)')).toBe(false);
    expect(pxOf('17px')).toBe(17);
    expect(pxOf('1.2rem')).toBeNull();
  });
});
