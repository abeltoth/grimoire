import { THEME_NAMES } from '@grimoire/contract';
import theme from '@ui/design-system/themes/grimoire.css' with { loader: 'text' };
import {
  DENSITIES,
  DENSITY_TOKENS,
  MAIN_TOKENS,
  TEXT_FONT,
  TEXT_FONTS,
  TEXT_SIZE,
  THEME_FILES,
  densityOf,
  hexOf,
  isColour,
  searchTokens,
  pxOf,
  textFontOf,
  tokenGroups,
  tokenValues,
  withDensity,
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
  --gr-page-right: var(--gr-page);

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
          { name: '--gr-page-right', value: 'var(--gr-page)' },
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

  it('are searched by name, value or heading', () => {
    const groups = tokenGroups(theme);
    const found = (query: string) =>
      searchTokens(groups, query).flatMap((group) => group.tokens.map((token) => token.name));
    expect(found('RUBRIC')).toContain('--gr-rubric');
    expect(found('#f3ebd9')).toEqual(['--gr-page']);
    expect(searchTokens(groups, 'composer').map((group) => group.title)).toEqual([
      'Chat: composer',
    ]);
    expect(searchTokens(groups, '  ')).toHaveLength(groups.length);
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

describe('the face and density of the text', () => {
  // As the service takes a token's value.
  const TOKEN_VALUE = /^[^;{}]{1,300}$/;
  const known = new Set(Object.keys(tokenValues(theme)));

  it('offers the book’s face first, which changes nothing, then faces the system has', () => {
    expect(known).toContain(TEXT_FONT);
    expect(TEXT_FONTS.map((font) => font.name)).toEqual(['book', 'sans', 'serif', 'mono']);
    expect(TEXT_FONTS[0]!.value).toBeNull();
    for (const font of TEXT_FONTS.slice(1)) {
      expect(font.value, font.name).toMatch(TOKEN_VALUE);
      expect(font.value, font.name).toMatch(/, (sans-serif|serif|monospace)$/);
    }
    expect(textFontOf({})).toBe('book');
    expect(textFontOf({ [TEXT_FONT]: TEXT_FONTS[3]!.value!, '--gr-page': '#ffffff' })).toBe('mono');
    expect(textFontOf({ [TEXT_FONT]: 'Comic Sans MS, cursive' })).toBeNull();
  });

  it('sets the same tokens closer or wider, Normal none of them', () => {
    expect(DENSITIES.map((density) => density.name)).toEqual(['compact', 'normal', 'roomy']);
    const [compact, normal, roomy] = DENSITIES;
    expect(normal!.tokens).toEqual({});
    expect(Object.keys(compact!.tokens)).toEqual(DENSITY_TOKENS);
    expect(Object.keys(roomy!.tokens)).toEqual(DENSITY_TOKENS);
    const drawn = tokenValues(theme);
    for (const token of DENSITY_TOKENS) {
      expect(known, token).toContain(token);
      const [close, asDrawn, wide] = [
        compact!.tokens[token]!,
        drawn[token]!,
        roomy!.tokens[token]!,
      ];
      expect(close, token).toMatch(TOKEN_VALUE);
      expect(wide, token).toMatch(TOKEN_VALUE);
      expect(parseFloat(close), token).toBeLessThan(parseFloat(asDrawn));
      expect(parseFloat(wide), token).toBeGreaterThan(parseFloat(asDrawn));
    }
  });

  it('says which density your changes make, and sets one in place of another', () => {
    const [compact, normal, roomy] = DENSITIES;
    expect(densityOf({})).toBe('normal');
    expect(densityOf({ '--gr-page': '#ffffff' })).toBe('normal');
    const close = withDensity({ '--gr-page': '#ffffff' }, compact!);
    expect(densityOf(close)).toBe('compact');
    expect(close['--gr-page']).toBe('#ffffff');
    expect(withDensity(close, roomy!)).toEqual({ '--gr-page': '#ffffff', ...roomy!.tokens });
    expect(withDensity(close, normal!)).toEqual({ '--gr-page': '#ffffff' });
    // One of its tokens changed by hand is none of them.
    expect(densityOf({ ...close, '--gr-space-3': '10px' })).toBeNull();
  });
});
