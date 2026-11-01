import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cssDeclarations,
  definedTokens,
  designSystem,
  filesUnder,
  inlineDeclarations,
  literalsIn,
  repoRoot,
  uiRoots,
  usedTokens,
} from './style-guard';

const outsideDesignSystem = (file: string) => !file.startsWith(designSystem + path.sep);
const relative = (file: string) => path.relative(repoRoot, file).replaceAll('\\', '/');
const filesIn = (extensions: string[]) => uiRoots().flatMap((root) => filesUnder(root, extensions));

describe('style guard', () => {
  it('finds no literal values outside the design system', () => {
    const problems: string[] = [];
    for (const file of filesIn(['.css', '.html']).filter(outsideDesignSystem)) {
      const source = readFileSync(file, 'utf8');
      const declarations = file.endsWith('.css')
        ? cssDeclarations(source)
        : [...source.matchAll(/\sstyle="([^"]*)"/g)].flatMap((m) => inlineDeclarations(m[1]!));
      for (const [property, value] of declarations) {
        for (const literal of literalsIn(property, value)) {
          problems.push(`${relative(file)}: ${property}: ${value} (${literal})`);
        }
      }
    }
    expect(problems, 'Use a --gr-* token from themes/grimoire.css instead').toEqual([]);
  });

  it('uses only tokens the theme defines', () => {
    const defined = definedTokens();
    const missing = filesIn(['.css', '.html', '.ts']).flatMap((file) =>
      usedTokens(readFileSync(file, 'utf8'))
        .filter((token) => !defined.has(token))
        .map((token) => `${relative(file)}: ${token}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('literalsIn', () => {
  it('accepts tokens, keywords, percentages, 0 and 1px', () => {
    expect(literalsIn('color', 'var(--gr-ink)')).toEqual([]);
    expect(literalsIn('border-bottom', '1px solid var(--gr-hairline)')).toEqual([]);
    expect(literalsIn('margin', '0 auto')).toEqual([]);
    expect(literalsIn('width', '100%')).toEqual([]);
    expect(literalsIn('font-family', 'inherit')).toEqual([]);
    expect(
      literalsIn('animation', 'gr-sway var(--gr-dur-sway) var(--gr-ease-sway) infinite'),
    ).toEqual([]);
  });

  it('flags literal colours, timings, lengths and fonts', () => {
    expect(literalsIn('color', '#a5321e')).toEqual(['colour']);
    expect(literalsIn('background', 'rgba(74, 48, 22, 0.07)')).toEqual(['colour']);
    expect(literalsIn('transition', 'opacity 200ms')).toEqual(['timing']);
    expect(literalsIn('padding', '6px var(--gr-space-2)')).toEqual(['length 6px']);
    expect(literalsIn('letter-spacing', '.06em')).toEqual(['length .06em']);
    expect(literalsIn('font-family', 'Georgia, serif')).toEqual(['font']);
  });

  it('reads declarations inside nested blocks and ignores at-rule conditions', () => {
    const css = '@media (max-width: 900px) { .a { gap: 4px; color: var(--gr-ink) } } /* b: 3px */';
    expect(cssDeclarations(css)).toEqual([
      ['gap', '4px'],
      ['color', 'var(--gr-ink)'],
    ]);
  });
});
