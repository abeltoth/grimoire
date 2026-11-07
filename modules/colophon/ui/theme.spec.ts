import { THEME_NAMES } from '@grimoire/contract';
import theme from '@ui/design-system/themes/grimoire.css' with { loader: 'text' };
import {
  MAIN_TOKENS,
  TEXT_SIZE,
  THEME_FILES,
  hexOf,
  isColour,
  lookUpTokens,
  pxOf,
  tokenGroups,
  tokenValues,
} from './theme';

/** WCAG 2's contrast between two colours, 1 to 21. */
function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = ([r, g, bl]: readonly number[]) => {
    const [lr, lg, lb] = [r, g, bl].map((channel) => {
      const c = channel! / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

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

  it('are read from a theme file, whatever it sets', () => {
    expect(
      tokenValues(`/* Night */
:root[data-theme='night'] {
  color-scheme: dark;
  /* Paper */
  --gr-page: #1f1a15;
  --gr-hairline: rgba(232, 215, 185, 0.14);
}`),
    ).toEqual({ '--gr-page': '#1f1a15', '--gr-hairline': 'rgba(232, 215, 185, 0.14)' });
  });

  it('are only the names grimoire.css has, in every ready-made theme', async () => {
    const known = new Set(Object.keys(tokenValues(theme)));
    for (const name of THEME_NAMES.filter((name) => name !== 'grimoire')) {
      const css = await THEME_FILES[name]();
      expect(css, name).toContain(`:root[data-theme='${name}']`);
      const own = Object.keys(tokenValues(css));
      expect(own.length, name).toBeGreaterThan(0);
      expect(
        own.filter((token) => !known.has(token)),
        `${name} sets tokens grimoire.css hasn't`,
      ).toEqual([]);
      // Every token it sets is set once.
      expect(own.length, name).toBe((css.match(/^\s*--gr-[a-z0-9-]+:/gm) ?? []).length);
    }
  });

  it('keep ink readable on the paper in every ready-made theme', async () => {
    const base = tokenValues(theme);
    for (const name of THEME_NAMES) {
      const own = name === 'grimoire' ? {} : tokenValues(await THEME_FILES[name]());
      const colour = (token: string): [number, number, number] => {
        let value = own[token] ?? base[token] ?? '';
        for (let hops = 0; value.startsWith('var(') && hops < 5; hops++) {
          const next = /var\((--[\w-]+)\)/.exec(value)![1]!;
          value = own[next] ?? base[next] ?? '';
        }
        const hex = hexOf(value);
        expect(hex, `${name} ${token} is ${value}`).not.toBeNull();
        return [1, 3, 5].map((at) => parseInt(hex!.slice(at, at + 2), 16)) as [
          number,
          number,
          number,
        ];
      };
      const page = colour('--gr-page');
      // Body ink and the colours text is set in, against the paper (WCAG 2: 4.5 is AA, 7 is AAA).
      const enough = name === 'contrast' ? 7 : 4.5;
      for (const token of [
        '--gr-ink',
        '--gr-ink-soft',
        '--gr-rubric',
        '--gr-lapis',
        '--gr-pen',
        '--gr-verdigris',
      ]) {
        expect(contrast(colour(token), page), `${name} ${token}`).toBeGreaterThanOrEqual(enough);
      }
    }
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
